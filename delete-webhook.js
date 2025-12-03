const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

async function deleteWebhook() {
  const response = await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
    }
  });
  
  const data = await response.json();
  
  console.log('Webhooks hien tai:');
  data.webhooks.forEach(w => {
    console.log(`ID: ${w.id}, Topic: ${w.topic}, Address: ${w.address}`);
  });
  
  const webhook = data.webhooks.find(w => w.topic === 'orders/paid');
  
  if (webhook) {
    console.log(`\nDang xoa webhook ID: ${webhook.id}...`);
    
    await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks/${webhook.id}.json`, {
      method: 'DELETE',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
      }
    });
    
    console.log('Da xoa webhook cu!');
  }
}

deleteWebhook();
