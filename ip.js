const net = require('net');
const os = require('os');

/**
 * Some IPv4 addresses are reserved for internal uses only, and cannot be
 * reached from other machines. We need to detect and filter them
 * @param  {String}  ip
 * @return {Boolean}
 */
function isInternalIP(ip) {
  // To my knowledge, there aren't any reserved, non-loopback and non-routable
  // IPv6 addresses
  if (net.isIPv6(ip)) {
    return false;
  }

  const exploded = ip.split('.').map(s => Number.parseInt(s));

  // 127.x.x: loopback addresses are already flagged as "internal" by
  // os.networkInterfaces.
  return exploded[0] === 127
    // 169.254.x.x addresses are APIPA addresses: temporary and non-routable.
    // We need to remove them from the accepted list of IP addresses
    // (this is a "just in case" scenario: APIPA addresses are obsolete and
    // should not be used anymore, but we never know...)
    || (exploded[0] === 169 && exploded[1] === 254);
}

/**
 * Return the first IP address matching the provided configuration
 * @param  {Object} [options]
 * @param  {String} [options.family] IP family (IPv4 or IPv6)
 * @param  {String} [options.interface] Network interface/IP/MAC to use
 * @param  {String} [options.ip] Used to target public or private addresses
 * @return {String|null}
 */
function getIP({ family = 'IPv4', interface: netInterface, ip } = {}) {
  const mustBePrivate = ip === 'private';

  let interfaces = [];

  for (const [key, value] of Object.entries(os.networkInterfaces())) {
    for (const _interface of value) {
      interfaces.push({
        interface: key,
        ..._interface,
      });
    }
  }

  interfaces = interfaces.filter(n => {
    return !n.internal
      && !isInternalIP(n.address)
      && n.family === family
      && (!ip || mustBePrivate === isPrivateIP(n.address));
  });

  if (interfaces.length === 0) {
    return null;
  }

  // take the first IP from the list if no interface has been defined
  if (!netInterface) {
    return interfaces[0].address;
  }

  for (const i of interfaces) {
    if ([i.interface, i.address, i.mac].includes(netInterface)) {
      return i.address;
    }
  }

  return null;
}

module.exports = {
  getIP
};