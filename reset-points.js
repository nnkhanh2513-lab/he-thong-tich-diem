const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

async function resetCustomer(customerId) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/customers/${customerId}/metafields.json`;
  
  const response = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_CONFIG.token }
  });
  
  const data = await response.json();
  
  for (const mf of data.metafields || []) {
    if (mf.namespace === 'loyalty') {
      console.log('Xóa:', mf.key);
      await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/customers/${customerId}/metafields/${mf.id}.json`, {
        method: 'DELETE',
        headers: { 'X-Shopify-Access-Token': SHOPIFY_CONFIG.token }
      });
    }
  }
  
  console.log('Reset xong!');
}

resetCustomer('8105337946248');

