// Test subprocess only: never send the fixture credentials to a real provider.
if (!process.env.MOCK_B2_URL) throw new Error('Backblaze test provider is required.');
const original = globalThis.fetch;
globalThis.fetch = (input, options = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname.endsWith('.backblazeb2.com') || /^pod-\d+-\d+-\d+\.backblaze\.com$/.test(url.hostname)) return original(process.env.MOCK_B2_URL, { ...options, headers: { ...options.headers, 'x-provider-url': url.href } });
  return original(input, options);
};
