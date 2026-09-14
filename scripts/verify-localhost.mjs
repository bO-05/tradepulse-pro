async function test() {
  try {
    const res = await fetch('http://localhost:5173/');
    console.log('Status:', res.status, res.statusText);
    const html = await res.text();
    console.log('Body length:', html.length);
    console.log('Includes TradePulse title:', html.includes('TradePulse'));
    console.log('Includes root div:', html.includes('id="root"'));
    console.log('SUCCESS: Vite dev server is serving TradePulse Pro at http://localhost:5173/');
  } catch (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  }
}
test();
