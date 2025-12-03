const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

async function createWebhook(webhookUrl) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`;
  
  console.log('Dang tao webhook...');
  console.log('Shopify API:', url);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      webhook: {
        topic: 'orders/paid',
        address: webhookUrl,
        format: 'json'
      }
    })
  });
  
  const data = await response.json();
  
  if (data.webhook) {
    console.log('\nWebhook da tao thanh cong!');
    console.log('ID:', data.webhook.id);
    console.log('Topic:', data.webhook.topic);
    console.log('Address:', data.webhook.address);
  } else {
    console.log('\nLoi:', JSON.stringify(data, null, 2));
  }
}

const webhookUrl = 'https://myth-glossary-panel-clothing.trycloudflare.com/webhooks/orders/paid';
createWebhook(webhookUrl);
