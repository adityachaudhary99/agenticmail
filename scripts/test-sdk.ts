/**
 * SDK smoke test — verifies the agenticmail package works end-to-end
 * without needing Docker/Stalwart running.
 */

// Test 1: Import from the core package source
console.log('=== Test 1: Imports ===');
import {
  AgenticMailClient,
  resolveConfig,
  ensureDataDir,
  AccountManager,
  MailSender,
  MailReceiver,
  InboxWatcher,
  DomainManager,
  GatewayManager,
  RelayGateway,
  CloudflareClient,
  DomainPurchaser,
  DNSConfigurator,
  TunnelManager,
  RELAY_PRESETS,
  getDatabase,
  closeDatabase,
  createTestDatabase,
  parseEmail,
} from '../packages/core/src/index.js';

console.log('✅ All imports resolved');

// Verify classes exist
const classes = {
  AgenticMailClient,
  AccountManager,
  MailSender,
  MailReceiver,
  InboxWatcher,
  DomainManager,
  GatewayManager,
  RelayGateway,
  CloudflareClient,
  DomainPurchaser,
  DNSConfigurator,
  TunnelManager,
};
for (const [name, cls] of Object.entries(classes)) {
  if (typeof cls !== 'function') {
    console.error(`❌ ${name} is not a function/class: ${typeof cls}`);
    process.exit(1);
  }
}
console.log(`✅ All ${Object.keys(classes).length} classes are valid constructors`);

// Test 2: Config resolution
console.log('\n=== Test 2: Config ===');
const config = resolveConfig({
  dataDir: '/tmp/agenticmail-test',
  masterKey: 'mk_test123',
});
console.log(`✅ Config resolved:`);
console.log(`   dataDir: ${config.dataDir}`);
console.log(`   masterKey: ${config.masterKey}`);
console.log(`   stalwart.url: ${config.stalwart.url}`);
console.log(`   api.port: ${config.api.port}`);

// Test 3: Relay presets
console.log('\n=== Test 3: Relay Presets ===');
console.log(`✅ Gmail preset: ${RELAY_PRESETS.gmail.smtpHost}:${RELAY_PRESETS.gmail.smtpPort}`);
console.log(`✅ Outlook preset: ${RELAY_PRESETS.outlook.smtpHost}:${RELAY_PRESETS.outlook.smtpPort}`);

// Test 4: SQLite database + migrations
console.log('\n=== Test 4: Database & Migrations ===');
const testDb = createTestDatabase();
const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{name: string}>;
console.log(`✅ Created in-memory database with ${tables.length} tables:`);
for (const t of tables) {
  console.log(`   - ${t.name}`);
}

// Verify gateway tables exist
const gatewayConfig = tables.find(t => t.name === 'gateway_config');
const purchasedDomains = tables.find(t => t.name === 'purchased_domains');
if (!gatewayConfig) { console.error('❌ gateway_config table missing'); process.exit(1); }
if (!purchasedDomains) { console.error('❌ purchased_domains table missing'); process.exit(1); }
console.log('✅ Gateway migration tables present');

// Test 5: Write and read from gateway_config
console.log('\n=== Test 5: Gateway Config Persistence ===');
testDb.prepare(`INSERT INTO gateway_config (id, mode, config) VALUES ('default', 'relay', ?)`).run(
  JSON.stringify({ relay: { provider: 'gmail', email: 'test@gmail.com' } })
);
const row = testDb.prepare('SELECT * FROM gateway_config WHERE id = ?').get('default') as any;
console.log(`✅ Wrote and read gateway config: mode=${row.mode}`);
const parsed = JSON.parse(row.config);
console.log(`   provider: ${parsed.relay.provider}, email: ${parsed.relay.email}`);

// Test 6: Agent CRUD (without Stalwart — test DB operations only)
console.log('\n=== Test 6: Agent DB Operations ===');
testDb.prepare(`INSERT INTO agents (id, name, email, api_key, stalwart_principal, metadata) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'test-id-1', 'bot1', 'bot1@localhost', 'ak_test123', 'bot1', JSON.stringify({ _gateway: 'relay' })
);
const agent = testDb.prepare('SELECT * FROM agents WHERE name = ?').get('bot1') as any;
console.log(`✅ Created agent: ${agent.name} <${agent.email}>`);
// Avoid logging the raw api key — even though this is a test script
// with a hardcoded `ak_test123`, the same script gets copied as a
// template for real diagnostics. Redact instead.
console.log(`   apiKey: ${typeof agent.api_key === 'string' ? agent.api_key.slice(0, 3) + '_***' : '***'}`);
console.log(`   metadata: ${agent.metadata}`);

// Test 7: RelayGateway instantiation
console.log('\n=== Test 7: RelayGateway ===');
const relay = new RelayGateway({
  onInboundMail: async (agentName, mail) => {
    console.log(`   Received mail for ${agentName}: ${mail.subject}`);
  },
});
console.log(`✅ RelayGateway created, configured=${relay.isConfigured()}, polling=${relay.isPolling()}`);

// Test 8: CloudflareClient instantiation
console.log('\n=== Test 8: CloudflareClient ===');
const cf = new CloudflareClient('fake-token', 'fake-account-id');
console.log('✅ CloudflareClient created (token + accountId)');

// Test 9: DomainPurchaser instantiation
console.log('\n=== Test 9: DomainPurchaser ===');
const purchaser = new DomainPurchaser(cf);
console.log('✅ DomainPurchaser created');

// Test 10: DNSConfigurator instantiation
console.log('\n=== Test 10: DNSConfigurator ===');
const dnsConfig = new DNSConfigurator(cf);
console.log('✅ DNSConfigurator created');

// Test 11: TunnelManager instantiation
console.log('\n=== Test 11: TunnelManager ===');
const tunnel = new TunnelManager(cf);
console.log(`✅ TunnelManager created, status: running=${tunnel.status().running}`);

// Test 12: GatewayManager instantiation (needs a mock StalwartAdmin)
console.log('\n=== Test 12: GatewayManager ===');
// Create a minimal mock stalwart
const mockStalwart = {
  createPrincipal: async () => {},
  deletePrincipal: async () => {},
  getPrincipal: async () => null,
  updatePrincipal: async () => {},
  listPrincipals: async () => [],
  healthCheck: async () => true,
} as any;

const gw = new GatewayManager({
  db: testDb,
  stalwart: mockStalwart,
});
const status = gw.getStatus();
console.log(`✅ GatewayManager created, mode=${status.mode}, healthy=${status.healthy}`);

// Test 13: AgenticMailClient instantiation
console.log('\n=== Test 13: AgenticMailClient ===');
const client = new AgenticMailClient({
  agentId: 'test-agent',
  apiKey: 'ak_test123',
  apiUrl: 'http://localhost:3100',
});
console.log('✅ AgenticMailClient created (API mode, not connected)');

// Cleanup
testDb.close();

console.log('\n========================================');
console.log('🎉 All 13 tests passed! SDK is working.');
console.log('========================================');
