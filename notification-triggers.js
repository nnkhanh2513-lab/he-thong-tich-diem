// notification-triggers.js - COMPLETE VERSION
const { sendNotification } = require('./notifications');

// ===== SHOPIFY GRAPHQL =====
const fetch = require('node-fetch');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN,
  apiVersion: '2024-10'
};

async function shopifyGraphQL(query, variables = null) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`;
  
  const body = { query };
  if (variables) body.variables = variables;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.errors && result.errors.length) {
    throw new Error('GraphQL errors: ' + JSON.stringify(result.errors));
  }
  
  return result.data;
}

function extractCustomerId(input) {
  const str = String(input);
  if (str.startsWith('gid://shopify/Customer/')) {
    return str.split('/').pop();
  }
  if (/^\d+$/.test(str)) return str;
  throw new Error('Invalid customer ID format: ' + str);
}

// ===== GET ALL CUSTOMERS =====
async function getAllCustomers(limit = 250) {
  const query = `
    query {
      customers(first: ${limit}) {
        edges {
          node {
            id
            email
          }
        }
      }
    }
  `;
  
  const data = await shopifyGraphQL(query);
  return data.customers.edges.map(edge => ({
    id: extractCustomerId(edge.node.id),
    email: edge.node.email
  }));
}

// ===== TRIGGER: NEW BOOK RELEASE =====
async function triggerNewBookRelease(productId, productData = {}) {
  try {
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'new_book_release',
        title: `📚 Sách mới: ${productData.title || 'Sách mới phát hành'}`,
        message: `Khám phá cuốn sách mới nhất của chúng tôi!`,
        link: `/products/${productData.handle || productId}`,
        data: {
          bookTitle: productData.title,
          bookImage: productData.image,
          description: productData.description,
          link: `/products/${productData.handle || productId}`
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} new book notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerNewBookRelease error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: PRICE DROP =====
async function triggerPriceDrop(productId, oldPrice, newPrice, productData = {}) {
  try {
    // For now, send to all customers
    // TODO: Filter by customers who have this product in wishlist
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'price_drop',
        title: `💰 Giảm giá: ${productData.title}`,
        message: `Giá giảm từ ${oldPrice.toLocaleString('vi-VN')}₫ xuống ${newPrice.toLocaleString('vi-VN')}₫!`,
        link: `/products/${productData.handle || productId}`,
        data: {
          productTitle: productData.title,
          oldPrice,
          newPrice,
          link: `/products/${productData.handle || productId}`
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} price drop notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerPriceDrop error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: BACK IN STOCK =====
async function triggerBackInStock(productId, productData = {}) {
  try {
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'back_in_stock',
        title: `✅ ${productData.title} đã có hàng trở lại!`,
        message: `Sản phẩm bạn quan tâm đã có hàng. Nhanh tay đặt hàng!`,
        link: `/products/${productData.handle || productId}`,
        data: {
          productTitle: productData.title,
          link: `/products/${productData.handle || productId}`
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} back in stock notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerBackInStock error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: NEW REVIEW =====
async function triggerNewReview(productId, reviewData, productData = {}) {
  try {
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'new_review',
        title: `⭐ Review mới cho "${productData.title}"`,
        message: `Xem review mới từ khách hàng khác!`,
        link: `/products/${productData.handle || productId}#reviews`,
        data: {
          productTitle: productData.title,
          rating: reviewData.rating || 5,
          reviewText: reviewData.text || '',
          reviewerName: reviewData.author || 'Khách hàng',
          link: `/products/${productData.handle || productId}#reviews`
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} new review notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerNewReview error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: PROMOTION =====
async function triggerPromotion({ title, message, code, link }) {
  try {
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'promotion',
        title: title || '🎉 Ưu đãi mới!',
        message: message || 'Khám phá ưu đãi đặc biệt dành cho bạn!',
        link: link || '/',
        data: {
          title,
          message,
          code,
          link
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} promotion notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerPromotion error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: UPDATE INFO =====
async function triggerUpdateInfo(customerId) {
  try {
    const result = await sendNotification(customerId, {
      type: 'update_info',
      title: '📝 Cập nhật thông tin tài khoản',
      message: 'Vui lòng cập nhật thông tin để nhận trải nghiệm tốt nhất!',
      link: '/account',
      data: {}
    });
    
    console.log(`✅ Sent update info notification to ${customerId}`);
    return result;
    
  } catch (error) {
    console.error('❌ triggerUpdateInfo error:', error);
    return { success: false, error: error.message };
  }
}

// ===== TRIGGER: MAINTENANCE =====
async function triggerMaintenance({ message, startTime, endTime }) {
  try {
    const customers = await getAllCustomers();
    
    const results = [];
    for (const customer of customers) {
      const result = await sendNotification(customer.id, {
        type: 'maintenance',
        title: '🔧 Thông báo bảo trì hệ thống',
        message: message || 'Hệ thống sẽ được bảo trì để nâng cấp trải nghiệm.',
        link: '/',
        data: {
          message,
          startTime,
          endTime
        }
      });
      results.push(result);
    }
    
    console.log(`✅ Sent ${results.filter(r => r.success).length}/${results.length} maintenance notifications`);
    return { success: true, sent: results.filter(r => r.success).length };
    
  } catch (error) {
    console.error('❌ triggerMaintenance error:', error);
    return { success: false, error: error.message };
  }
}

// ===== EXPORTS =====
module.exports = {
  triggerNewBookRelease,
  triggerPriceDrop,
  triggerBackInStock,
  triggerNewReview,
  triggerPromotion,
  triggerUpdateInfo,
  triggerMaintenance
};
