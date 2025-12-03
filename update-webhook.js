const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

async function updateWebhook() {
  // 1. Lấy danh sách webhooks
  const response = await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
    }
  });
  
  const data = await response.json();
  
  console.log('Webhooks hiện tại:');
  data.webhooks.forEach(w => {
    console.log(`ID: ${w.id}, Topic: ${w.topic}, Address: ${w.address}`);
  });
  
  // 2. Tìm webhook orders/paid
  const webhook = data.webhooks.find(w => w.topic === 'orders/paid');
  
  if (webhook) {
    console.log(`\nĐang xóa webhook cũ ID: ${webhook.id}...`);
    
    // 3. Xóa webhook cũ
    await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks/${webhook.id}.json`, {
      method: 'DELETE',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
      }
    });
    
    console.log('✅ Đã xóa webhook cũ!');
  }
  
  // 4. Tạo webhook mới
  const newWebhookUrl = 'https://prefers-election-private-exams.trycloudflare.com/webhooks/orders/paid';
  
  console.log(`\nĐang tạo webhook mới: ${newWebhookUrl}...`);
  
  const createResponse = await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      webhook: {
        topic: 'orders/paid',
        address: newWebhookUrl,
        format: 'json'
      }
    })
  });
  
  const newWebhook = await createResponse.json();
  
  if (newWebhook.webhook) {
    console.log('\n✅ Webhook mới đã tạo thành công!');
    console.log('ID:', newWebhook.webhook.id);
    console.log('Topic:', newWebhook.webhook.topic);
    console.log('Address:', newWebhook.webhook.address);
  } else {
    console.log('\n❌ Lỗi:', JSON.stringify(newWebhook, null, 2));
  }
}

updateWebhook();
