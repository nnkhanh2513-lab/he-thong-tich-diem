// notifications.js
const fetch = require('node-fetch');
const { metafieldsSetPayload } = require('./loyaltytasks');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',
  apiVersion: '2024-10'
};

// Gửi thông báo mới
async function sendNotification(customerId, { type, title, message, link = null }) {
  try {
    // 1. Lấy metafields hiện tại
    const customer = await getCustomerMetafields(customerId);
    
    // 2. Lấy history và preferences
    let history = { notifications: [] };
    let preferences = { channels: { in_app: true, email: true }, types: {} };
    
    if (customer.metafields?.loyalty_notifications?.history) {
      history = JSON.parse(customer.metafields.loyalty_notifications.history);
    }
    
    if (customer.metafields?.loyalty_notifications?.preferences) {
      preferences = JSON.parse(customer.metafields.loyalty_notifications.preferences);
    }
    
    // 3. Kiểm tra preferences - có muốn nhận loại thông báo này không?
    if (preferences.types[type] === false) {
      console.log(`⏭️ Customer ${customerId} đã tắt thông báo ${type}`);
      return { success: false, message: 'User disabled this notification type' };
    }
    
    // 4. Tạo thông báo mới
    const newNotif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      link
    };
    
    // 5. Thêm vào đầu danh sách
    history.notifications.unshift(newNotif);
    
    // 6. Giới hạn 50 thông báo gần nhất
    if (history.notifications.length > 50) {
      history.notifications = history.notifications.slice(0, 50);
    }
    
    // 7. Tính unread count
    const unreadCount = history.notifications.filter(n => !n.read).length;
    
    // 8. Update metafields
    await updateCustomerMetafields(customerId, {
      'loyalty_notifications.history': JSON.stringify(history),
      'loyalty_notifications.unread_count': unreadCount,
      'loyalty_notifications.last_notification_sent': new Date().toISOString()
    });
    
    console.log(`✅ Đã gửi thông báo "${title}" cho customer ${customerId}`);
    return { success: true, notification: newNotif };
    
  } catch (error) {
    console.error('Error sending notification:', error);
    return { success: false, error: error.message };
  }
}

// Đánh dấu tất cả đã đọc
async function markAllRead(customerId) {
  try {
    const customer = await getCustomerMetafields(customerId);
    
    if (!customer.metafields?.loyalty_notifications?.history) {
      return { success: true, message: 'No notifications' };
    }
    
    const history = JSON.parse(customer.metafields.loyalty_notifications.history);
    
    // Đánh dấu tất cả read = true
    history.notifications.forEach(n => n.read = true);
    
    await updateCustomerMetafields(customerId, {
      'loyalty_notifications.history': JSON.stringify(history),
      'loyalty_notifications.unread_count': 0
    });
    
    console.log(`✅ Đã đánh dấu tất cả thông báo đã đọc cho customer ${customerId}`);
    return { success: true };
    
  } catch (error) {
    console.error('Error marking all read:', error);
    return { success: false, error: error.message };
  }
}

// Đánh dấu 1 thông báo đã đọc
async function markAsRead(customerId, notificationId) {
  try {
    const customer = await getCustomerMetafields(customerId);
    
    if (!customer.metafields?.loyalty_notifications?.history) {
      return { success: false, message: 'No notifications' };
    }
    
    const history = JSON.parse(customer.metafields.loyalty_notifications.history);
    const notif = history.notifications.find(n => n.id === notificationId);
    
    if (!notif) {
      return { success: false, message: 'Notification not found' };
    }
    
    notif.read = true;
    
    const unreadCount = history.notifications.filter(n => !n.read).length;
    
    await updateCustomerMetafields(customerId, {
      'loyalty_notifications.history': JSON.stringify(history),
      'loyalty_notifications.unread_count': unreadCount
    });
    
    return { success: true };
    
  } catch (error) {
    console.error('Error marking as read:', error);
    return { success: false, error: error.message };
  }
}

// Helper: Lấy metafields của customer
async function getCustomerMetafields(customerId) {
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        id
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;
  
  const response = await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
    },
    body: JSON.stringify({ query })
  });
  
  const data = await response.json();
  
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  
  const customer = data.data.customer;
  const metafields = {};
  
  customer.metafields.edges.forEach(({ node }) => {
    if (!metafields[node.namespace]) {
      metafields[node.namespace] = {};
    }
    metafields[node.namespace][node.key] = node.value;
  });
  
  return { id: customer.id, metafields };
}

// Helper: Lấy metafields của customer (GIỮ NGUYÊN)
async function getCustomerMetafields(customerId) {
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        id
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;
  
  const response = await fetch(`https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token
    },
    body: JSON.stringify({ query })
  });
  
  const data = await response.json();
  
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  
  const customer = data.data.customer;
  const metafields = {};
  
  customer.metafields.edges.forEach(({ node }) => {
    if (!metafields[node.namespace]) {
      metafields[node.namespace] = {};
    }
    metafields[node.namespace][node.key] = node.value;
  });
  
  return { id: customer.id, metafields };
}

// ✅ Helper: Update metafields - FIXED VERSION
async function updateCustomerMetafields(customerId, updates) {
  const metafieldsArray = Object.entries(updates).map(([key, value]) => {
    const [namespace, fieldKey] = key.split('.');
    
    let type = 'json';
    if (typeof value === 'number') {
      type = 'number_integer';
    } else if (key.includes('last_notification_sent')) {
      type = 'date_time';
    }
    
    return {
      ownerId: `gid://shopify/Customer/${customerId}`,
      namespace,
      key: fieldKey,
      value,
      type
    };
  });
  
  // ✅ Tái sử dụng hàm từ loyaltytasks.js
  return await metafieldsSetPayload(metafieldsArray);
}

module.exports = {
  sendNotification,
  markAllRead,
  markAsRead
};
