# Direct File Transfer

A Client and Server that allows you to upload and download files directly from a computer to another just by using a code.

Connections between Client and Server are encrypted with TLS

The Server does not store any of the transfered data, the server only act as a bridge between two clients.

## Usage

### Client
```
usage: sdft [-h] [-v] [-l HOST] [-n PORT] [-u PATH] [-d CODE] [-p PASSWORD]

Download or Upload file directly from/to other devices

optional arguments:
  -h, --help            show this help message and exit
  -v, --version         show program's version number and exit
  -l HOST, --host HOST  Host of Transfer Server (default: undefined)
  -n PORT, --port PORT  Port of Transfer Server (default: undefined)
  -u PATH, --upload PATH
                        Upload a file / directory (default: undefined)
  -d CODE, --download CODE
                        Download a file / directory from a device (default: undefined)
  -p PASSWORD, --password PASSWORD
                        File password (default: undefined)
```

### Server

A server is present in the package

**Configure Server**
Edit the given `config.js` file
```js
module.exports = {
  client: {
    host: process.env.DFT_HOST,
    port: process.env.DFT_PORT,
  },
  server: {
    port: 9966,
    key: `${__dirname}/cert/key.pem`,
    cert: `${__dirname}/cert/cert.pem`,
    codeSize: 5,
  }
}
```

**Run Server**
```shell
npm run host
```

## Examples

**Upload a file or a folder**
```shell
sdft --upload /home/my_folder
# Your Code: XCFV0
```

**Download a file**
```shell
sdft --download XCFV0
# Download completed
```