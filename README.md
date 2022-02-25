# Direct File Transfer

A Client and Server that allow you to upload and download files directly from a computer to another just by using a code.

Connections between Client and Server are encrypted with TLS

The Server does not store any of the transfered data, the server only act as a bridge between two clients.

## Usage
```
usage: dft [-h] [-v] [-u PATH] [-d CODE] [-p PASSWORD]

Download or Upload file directly to other devices on your local network

optional arguments:
  -h, --help            show this help message and exit
  -v, --version         show program's version number and exit
  -u PATH, --upload PATH
                        Upload a file / directory (default: undefined)
  -d CODE, --download CODE
                        Download a file / directory from a device (default: undefined)
  -p PASSWORD, --password PASSWORD
                        File password (default: undefined)
```

## Examples

**Upload a file or a folder**
```shell
dft --upload /home/my_folder
# Your Code: XCFV0
```

**Download a file**
```shell
dft --download XCFV0
# Download completed
```