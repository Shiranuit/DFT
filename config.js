module.exports = {
  client: {
    host: 'localhost',
    port: 9966,
  },
  server: {
    port: 9966,
    key: `${__dirname}/cert/key.pem`,
    cert: `${__dirname}/cert/cert.pem`,
    codeSize: 5,
  }
}