#!/usr/bin/env node

const tls = require('tls');
const config = require('../config');
const fs = require('fs');
const { getIP } = require('./ip');
const { version } = require('../package.json');
const { ArgumentParser, ArgumentDefaultsHelpFormatter } = require('argparse');
const path = require('path');
const cliProgress = require('cli-progress');
const Archiver = require('archiver');
const filesize = require('filesize');
const zipArchiver = Archiver('zip', {
  zlib: {
    level: 9,
  }
});
const DecompressZip = require('decompress-zip');

const parser = new ArgumentParser({
  description: 'Download or Upload file directly from/to other devices',
  formatter_class: ArgumentDefaultsHelpFormatter
});

parser.add_argument('-v', '--version', { action: 'version', version });
parser.add_argument('-l', '--host', { help: 'Host of Transfer Server', metavar: 'HOST', type: 'str' });
parser.add_argument('-n', '--port', { help: 'Port of Transfer Server', metavar: 'PORT', type: 'str' });
parser.add_argument('-u', '--upload', { help: 'Upload a file / directory', metavar: 'PATH', type: 'str' });
parser.add_argument('-d', '--download', { help: 'Download a file / directory from a device', metavar: 'CODE', type: 'str' });
parser.add_argument('-p', '--password', { help: 'File password', type: 'str', default: undefined });

const args = parser.parse_args();

// If not upload or download argument has been specified, show the help
if (!args.upload && !args.download) {
  console.debug(parser.format_help());
  process.exit(0);
}

/**
 * Sends information about the transfer and wait for code attribution
 * @param {tls.TLSSocket} socket
 * @param {*} callback
 */
function handshake(socket, callback) {
  const info = {
    localIP: getIP(), // Might be used later to make a local download when clients are on the same network
    transferType: args.upload ? 'upload' : 'download',
    password: args.password,
  };

  const sendInfo = () => {
    const stat = fs.lstatSync(`./${path.basename(args.upload)}.zip`);
    info.fileSize = stat.size;
    socket.write(JSON.stringify(info));
  }

  socket.once('data', (data) => {
    try {
      const response = JSON.parse(data);

      if (response.error) {
        callback(response);
        return;
      }

      if (response.seq !== 'FINALIZE_HANDSHAKE') {
        console.error('Invalid response during handshake');
        process.exit(1);
      }

      callback(response);
    } catch (err) {
      console.error('Failed to parse handshake response:', err);
      process.exit(1);
    }
  });

  if (args.upload) {
    if (!fs.existsSync(args.upload)) {
      console.error('File not found:', args.upload);
      process.exit(1);
    }

    const stats = fs.lstatSync(args.upload);

    if (!stats.isDirectory() && !stats.isFile()) {
      console.error('Invalid file type, must be a file or directory');
      process.exit(1);
    }

    info.fileName = path.basename(args.upload);
    info.fileType = stats.isDirectory() ? 'directory' : 'file';
    if (stats.isDirectory()) {
      compressDirectory(args.upload, sendInfo)
    } else {
      compressFile(args.upload, sendInfo);
    }
  } else {
    info.clientCode = args.download; // Code of the uploader
    socket.write(JSON.stringify(info));
  }
}

/**
 * Wait for piping to be completed on the server side
 * @param {tls.TLSSocket} socket
 * @param {*} callback
 */
function waitPipingCompletion(socket, callback) {
  socket.once('data', (data) => {
    try {
      const response = JSON.parse(data);

      if (response.error) {
        callback(response);
        return;
      }

      if (response.seq !== 'PIPING_COMPLETE') {
        console.error('Invalid response during handshake');
        process.exit(1);
      }

      callback(response);
    } catch (err) {
      console.error('Failed to parse handshake response:', err);
      process.exit(1);
    }
  });
}

/**
 * Prepare the directory downloading
 * @param {*} socket
 * @param {*} info
 */
function prepareDownload(socket, info) {
  let downloadedSize = 0;
  let start = Date.now();

  const progressbar = new cliProgress.SingleBar({
    format: 'Downloading | {bar} | {percentage}% | {formattedValue}/{formattedTotal} | Speed: {speed}/s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  progressbar.start(info.fileSize, 0, {
    formattedTotal: filesize(info.fileSize),
    speed: 'N/A'
  });
  // Create a file stream to write zip file data to it
  const writeStream = fs.createWriteStream(`./${info.fileName}.zip`);
  socket.on('data', (chunk) => {
    const success = writeStream.write(chunk);
    if (! success) {
      socket.pause();
      writeStream.once('drain', () => {
        socket.resume();
      });
    }

    downloadedSize += chunk.length;
    progressbar.update(downloadedSize, {
      formattedValue: filesize(downloadedSize),
      speed: filesize(downloadedSize / ((Date.now() - start) / 1000)),
    });
  });

  // Once the zip file has been downloaded, unzip it
  socket.on('close', () => {

    progressbar.update(info.fileSize, {
      formattedValue: filesize(info.fileSize),
      speed: filesize(downloadedSize / ((Date.now() - start) / 1000)),
    });
    progressbar.stop();
    console.debug('Download compressed file');
    //  Decompress zip archive
    const unzipper = new DecompressZip(`./${info.fileName}.zip`);
    unzipper.on('error', (err) => {
      console.error('Caught an error during decompression', err);
      process.exit(1);
    });

    unzipper.on('extract', () => {
      fs.rmSync(`./${info.fileName}.zip`);
      console.debug('Decompression complete');
    });

    console.debug('Decompressing...');

    unzipper.extract({
      path: info.fileType === 'directory'
        ? `./${info.fileName}`
        : '.',
      restrict: false,
    });
  });
}

/**
 * Compress a file
 */
function compressFile(file, callback) {
  console.debug(`Start compressing file: ${file}`);
  const zip = zipArchiver.file(file, { name: path.basename(file) });
  const writeStream = fs.createWriteStream(`./${path.basename(file)}.zip`);
  zip.pipe(writeStream);
  zip.finalize();
  zip.on('end', () => {
    console.debug('File compression complete');
    callback();
  });
}

/**
 * Compress a directory
 */
function compressDirectory(file, callback) {
  console.debug(`Start compressing directory: ${file}`);
  const zip = zipArchiver.directory(file, false);
  const writeStream = fs.createWriteStream(`./${path.basename(file)}.zip`);
  zip.pipe(writeStream);
  zip.finalize();
  zip.on('end', () => {
    console.debug('Directory compression complete');
    callback();
  });
}

/**
 * Choose which upload method to use based on the file type
 * @param {tls.TLSSocket} socket
 */
function upload(socket) {
  const stat = fs.lstatSync(`./${path.basename(args.upload)}.zip`);

  const progressbar = new cliProgress.SingleBar({
    format: 'Uploading | {bar} | {percentage}% | {formattedValue}/{formattedTotal} | Speed: {speed}/s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  const readStream = fs.createReadStream(`./${path.basename(args.upload)}.zip`);

  let uploadedSize = 0;
  let start = Date.now();

  readStream.on('data', (chunk) => {
    const success = socket.write(chunk);
    if (! success) {
      readStream.pause();
      socket.once('drain', () => {
        readStream.resume();
      });
    }
    uploadedSize += chunk.length;
    progressbar.update(uploadedSize, {
      formattedValue: filesize(uploadedSize),
      speed: filesize(uploadedSize / ((Date.now() - start) / 1000)),
    });
  });

  readStream.on('end', () => {
    socket.end();
    fs.rmSync(`./${path.basename(args.upload)}.zip`);
    progressbar.update(stat.size, {
      formattedValue: filesize(uploadedSize),
      speed: filesize(uploadedSize / ((Date.now() - start) / 1000)),
    });
    progressbar.stop();
    console.debug('Upload complete');
  });

  progressbar.start(stat.size, 0, { speed: 'N/A', formattedTotal: filesize(stat.size) });
}

/**
 * Wait for the downloader to notify that he is ready
 * @param {tls.TLSSocket} socket
 * @param {*} callback
 */
function waitDownloaderReady(socket, callback) {
  socket.once('data', (data) => {
    if (data.toString() === 'READY') {
      callback();
    } else {
      console.error('Invalid response while waiting for downloader to be ready');
      process.exit(1);
    }
  });
}

const socket = tls.connect({
  host: config.client.host || args.host || 'localhost',
  port: parseInt(config.client.port) || parseInt(args.port) || 9966,
  key: config.client.key ? fs.readFileSync(config.client.key) : undefined,
  cert: config.client.cert ? fs.readFileSync(config.client.cert) : undefined,
  ca: config.client.ca ? fs.readFileSync(config.client.ca) : undefined,
  rejectUnauthorized: false,
}, () => {
  handshake(socket, (res) => {
    if (res.error) {
      console.error(res.error);
      process.exit(1);
    }

    console.log(`Your Code: ${res.code}`);
    if (args.download) {
      waitPipingCompletion(socket, (info) => {
        socket.write('READY'); // Notify the uploader that we are ready
        prepareDownload(socket, info);
      });
    } else {
      waitDownloaderReady(socket, () => {
        upload(socket);
      });
    }
  })
});

socket.on('error', (err) => {
  console.error('Failed to connect to the server', err);
})