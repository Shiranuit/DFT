module.exports = {
  client: {
    host: process.env.DFT_HOST || 'localhost',
    port: process.env.DFT_PORT || 9966,
  },
  server: {
    port: 9966,
    key: `${__dirname}/cert/key.pem`,
    cert: `${__dirname}/cert/cert.pem`,
    codeSize: 5,
  }
}