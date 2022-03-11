#!/usr/bin/env node

const tls = require('tls');
const config = require('../config')
const fs = require('fs');
const crypto = require('crypto');

const allowedChars = config.server.allowedChars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const codes = new Map();

/**
 * Generate a random code of the given size
 * @param {integer} size
 * @returns {string} code
 */
function genCode(size) {
  let code = '';
  for (let i = 0; i < size; i++) {
    const char = crypto.randomInt(allowedChars.length);
    code += allowedChars[char];
  }
  return code;
}

/**
 * Generate a unique random code not already used
 * @param {integer} size
 * @returns unique code
 */
function genUniqueCode(size) {
  let code = genCode(size);

  while (codes.has(code)) {
    code = genCode(size);
  }

  return code;
}

/**
 * Verify client informations before giving them a code
 * @param {tls.TLSSocket} socket
 * @param {*} callback
 */
function handshake(socket, callback) {
  socket.once('data', (data) => {
    try {
      const transferInfo = JSON.parse(data);

      if (!transferInfo.transferType) {
        callback(null, new Error('Missing transfer type'));
        return;
      }

      if (transferInfo.transferType === 'upload'
        && ( !transferInfo.fileName
          || !transferInfo.fileType)
      ) {
        callback(null, new Error('Missing file name or type'));
        return;
      }

      if (transferInfo.transferType === 'download'
      && !transferInfo.clientCode) {
        callback(null, new Error('Missing client code'));
        return;
      }

      if (transferInfo.transferType === 'download'
      && ! codes.has(transferInfo.clientCode)) {
        callback(null, new Error('Download ID not found'));
        return;
      }

      if (transferInfo.transferType === 'download') {
        const uploader = codes.get(transferInfo.clientCode);

        if (uploader.transferType !== 'upload') {
          callback(null, new Error('Download ID not found'));
          return;
        }

        if (uploader.busy) {
          callback(null, new Error('Download ID busy'));
          return;
        }

        if (uploader.password && !transferInfo.password) {
          callback(null, new Error('Password does not match'));
          return;
        }

        if (uploader.password
          && !crypto.timingSafeEqual(Buffer.from(uploader.password.toString()), Buffer.from(transferInfo.password.toString()))
        ) {
          callback(null, new Error('Password does not match'));
          return;
        }
      }

      transferInfo.code = genUniqueCode(config.server.codeSize || 5);

      // Cleanup routine once a connection is closed
      socket.once('close', () => {
        if (!transferInfo.code) {
          return;
        }

        // Delete information based on the code
        // Allow reuse of the code for another connection
        codes.delete(transferInfo.code);
        transferInfo.socket = undefined;
        console.debug('Connection close:', transferInfo);
      });

      codes.set(transferInfo.code, transferInfo);

      // Finalize handshake by sending the attributed code to the client
      socket.write(JSON.stringify({
        seq: 'FINALIZE_HANDSHAKE',
        code: transferInfo.code,
      }));

      callback(transferInfo);
    } catch (err) {
      callback(null, err);
    }
  })
}


const server = tls.createServer({
  key: config.server.key ? fs.readFileSync(config.server.key) : undefined,
  cert: config.server.cert ? fs.readFileSync(config.server.cert) : undefined,
  rejectUnauthorized: false
});

server.on('error', (err) => {
  console.error(err);
});

/**
 * Handle incoming connections
 */
server.on('secureConnection', (socket) => {
  handshake(socket, (info, err) => {

    if (err) {
      // Sends the error to the client if something fails during the handshake
      console.error('Failed to finish handshake:', err.message);
      socket.write(JSON.stringify({
        error: err.message,
      }));
      socket.destroy();
      return;
    }

    console.debug('New Connection:', info);
    info.socket = socket;

    if (info.transferType === 'download') {
      // Once we get here, we need to pipe the connections between them
      // so they can communicate and start the file transfer
      const uploader = codes.get(info.clientCode);
      uploader.busy = true; // Mark the uploader as busy

      uploader.socket.pipe(socket);
      socket.pipe(uploader.socket);
      uploader.socket.on('error', (err) => {
        console.log('Uploader socket error', uploader, err);
      });
      socket.on('error', (err) => {
        console.log('Downloader socket error', info, err);
      });

      // Once the pipe is done, notify the downloader
      // so it can setup the file download and inform the uploader when ready
      socket.write(JSON.stringify({
        seq: 'PIPING_COMPLETE',
        fileType: uploader.fileType,
        fileName: uploader.fileName,
        fileSize: uploader.fileSize,
      }));
    }
  });
});

/**
 * Start the server
 */
server.listen(config.server.port, () => {
  console.log('Server listening on port:', config.server.port);
});