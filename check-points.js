const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

async function shopifyAPI(endpoint) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    }
  });
  
  return await response.json();
}

async function checkPoints() {
  const customerId = '8105337946248';
  
  console.log('=== METAFIELDS CUA KHACH HANG ===\n');
  
  const data = await shopifyAPI(`/customers/${customerId}/metafields.json`);
  
  if (data.errors) {
    console.log('Loi:', data.errors);
    return;
  }
  
  if (!data.metafields || data.metafields.length === 0) {
    console.log('Chua co metafields nao!');
    return;
  }
  
  const pointsBatches = data.metafields.find(m => m.key === 'points_batches');
  
  if (!pointsBatches) {
    console.log('Chua co diem!');
    return;
  }
  
  const batches = JSON.parse(pointsBatches.value);
  const totalPoints = batches.reduce((sum, b) => sum + b.points, 0);
  
  console.log('Tong diem:', totalPoints);
  console.log('\nCac goi diem:');
  
  batches.forEach((batch, i) => {
    const daysLeft = Math.ceil((new Date(batch.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    console.log(`  Goi ${i+1}: ${batch.points} diem - Con ${daysLeft} ngay`);
  });
}

checkPoints();
