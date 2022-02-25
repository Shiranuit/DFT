const tls = require('tls');
const config = require('./config');
const fs = require('fs');
const { getIP } = require('./ip');
const { version } = require('./package.json');
const { ArgumentParser, ArgumentDefaultsHelpFormatter } = require('argparse');
const path = require('path');
const Archiver = require('archiver');
const zipArchiver = Archiver('zip');
const DecompressZip = require('decompress-zip');

const parser = new ArgumentParser({
  description: 'Download or Upload file directly to other devices on your local network',
  formatter_class: ArgumentDefaultsHelpFormatter
});

parser.add_argument('-v', '--version', { action: 'version', version });
parser.add_argument('-u', '--upload', { help: 'Upload a file / directory', metavar: 'PATH', type: 'str' });
parser.add_argument('-d', '--download', { help: 'Download a file / directory from a device', metavar: 'ID', type: 'str' });
parser.add_argument('-p', '--password', { help: 'File password', type: 'str', default: undefined });

const args = parser.parse_args();

// If not upload or download argument has been specified, show the help
if (!args.upload && !args.download) {
  console.log(parser.format_help());
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
  }

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
  } else {
    info.clientCode = args.download; // Code of the uploader
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

  socket.write(JSON.stringify(info));
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
 * Prepare the file downloading
 * @param {tls.TLSSocket} socket 
 * @param {*} info 
 */
function prepareFileDownload(socket, info) {
  // Create a file stream to write file data to it
  const writeStream = fs.createWriteStream(`./${info.fileName}`);
  socket.pipe(writeStream);
  socket.on('end', () => {
    console.log('Download completed');
  });
}

/**
 * Prepare the directory downloading
 * @param {*} socket 
 * @param {*} info 
 */
function prepareDirectoryDownload(socket, info) {
  // Create a file stream to write zip file data to it
  const writeStream = fs.createWriteStream(`./${info.fileName}.zip`);
  socket.pipe(writeStream);

  // Once the zip file has been downloaded, unzip it
  socket.on('close', () => {
    console.log('Download directory as zip');
    //  Decompress zip archive
    const unzipper = new DecompressZip(`./${info.fileName}.zip`);
    unzipper.on('error', (err) => {
      console.error('Caught an error during decompression', err);
      process.exit(1);
    });

    unzipper.on('extract', () => {
      fs.rmSync(`./${info.fileName}.zip`);
      console.log('Decompression complete');
    });

    console.log('Decompressing...');

    unzipper.extract({
      path: `./${info.fileName}`,
      restrict: false,
    });
  });
}

/**
 * Choose how to setup the download based on the file type
 * @param {tls.TLSSocket} socket 
 * @param {*} info 
 */
function prepareDownload(socket, info) {
  if (info.fileType === 'directory') {
    prepareDirectoryDownload(socket, info);
  } else {
    prepareFileDownload(socket, info);
  }
}

/**
 * Send a file through the socket
 * @param {tls.TLSSocket} socket 
 */
function uploadFile(socket) {
  const readStream = fs.createReadStream(args.upload);
  readStream.pipe(socket);
  readStream.on('end', () => {
    console.log('Upload completed');
  })
}

/**
 * Zip a directory and send it through the socket
 * @param {tls.TLSSocket} socket 
 */
function uploadDirectory(socket) {
  const zip = zipArchiver.directory(args.upload, false);
  zip.pipe(socket);
  zip.finalize();
  zip.on('end', () => {
    console.log('Upload completed');
  });
}

/**
 * Choose which upload method to use based on the file type
 * @param {tls.TLSSocket} socket 
 */
function upload(socket) {
  const stats = fs.lstatSync(args.upload);

  if (stats.isDirectory()) {
    uploadDirectory(socket);
  } else {
    uploadFile(socket);
  }
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
  host: config.client.host,
  port: config.client.port,
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
        prepareDownload(socket, info);
        socket.write('READY'); // Notify the uploader that we are ready
        console.log('Downloading...');
      });
    } else {
      waitDownloaderReady(socket, () => {
        console.log('Starting upload...');
        upload(socket);
      });
    }
  })
});

socket.on('error', (err) => {
  console.error('Failed to connect to the server', err);
})