import assert from 'node:assert/strict';
import test from 'node:test';
import * as host from '../index.js';
import { BOOTSTRAP_KEY as clientKey, ENTRY_PATH as clientPath, isPrivateIPv4 as clientPrivate, readBootstrap } from '../src/client.js';
import { BOOTSTRAP_KEY, ENTRY_PATH, isPrivateIPv4 } from '../src/shared/contract.js';

const addresses = [
  '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.62',
  '172.15.0.1', '172.32.0.1', '192.169.0.1', '203.0.113.7', '127.0.0.1', '0.0.0.0',
  '10.0.0', '10.0.0.256', ' 10.0.0.1', '10.0.0.1/24', '',
];

const ctx = {
  webApp: { getAdvertisedUrl: () => 'http://192.168.1.62:50020/' },
  webServer: { host: '192.168.1.62', port: 50020, protocol: 'http:', getOrigin: () => 'http://192.168.1.62:50020' },
};

test('host and client share the entry path, bootstrap key and private-address rule', () => {
  assert.equal(host.ENTRY_PATH, ENTRY_PATH);
  assert.equal(host.BOOTSTRAP_KEY, BOOTSTRAP_KEY);
  assert.equal(clientKey, BOOTSTRAP_KEY);
  assert.equal(clientPath, ENTRY_PATH);
  assert.equal(ENTRY_PATH, '/lan');
  assert.equal(BOOTSTRAP_KEY, '__DSH_LAN_CONNECT__');
  for (const address of addresses) assert.equal(clientPrivate(address), isPrivateIPv4(address), address);
});

test('host filtering and client validation agree on every candidate', () => {
  const interfaces = Object.fromEntries(addresses.map((address, index) => [`eth${index}`, [{ family: 'IPv4', internal: false, address }]]));
  const hostCandidates = host.connectionInfo(ctx, interfaces).lanAddresses.map(candidate => candidate.address);
  const record = readBootstrap({
    entryUrl: 'http://192.168.1.62:50020/lan',
    host: '192.168.1.62',
    port: 50020,
    protocol: 'http:',
    loopback: false,
    lanAddresses: hostCandidates.map((address, index) => ({ name: `eth${index}`, address, bound: false })),
  });
  assert.ok(record);
  assert.deepEqual(hostCandidates, addresses.filter(address => isPrivateIPv4(address)));
  assert.deepEqual(record.lanAddresses.map(candidate => candidate.address), hostCandidates);
});
