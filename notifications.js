// notifications.js - COMPLETE VERSION WITH EMAIL TEMPLATES
const fetch = require('node-fetch');
const { metafieldsSetPayload } = require('./loyaltytasks');

const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: process.env.SHOPIFY_TOKEN || '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',
  apiVersion: '2024-10'
};

// ===== EMAIL TEMPLATES =====
const EMAIL_TEMPLATES = {
  points_earned: (data) => ({
    subject: `🌊 Bạn vừa nhận ${data.points} điểm!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 32px;">🌊 +${data.points} điểm</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Chúc mừng!</h2>
          <p style="font-size: 16px; line-height: 1.6;">
            ${data.message}
          </p>
          <p style="font-size: 14px; color: #666;">
            Tổng điểm hiện tại: <strong>${data.totalPoints || 0} điểm</strong>
          </p>
          <a href="https://ket-noi-tri-thuc.myshopify.com/account" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px;">
            Xem điểm thưởng
          </a>
        </div>
      </div>
    `
  }),
  
  voucher_created: (data) => ({
    subject: `🎁 Voucher ${data.code} đã sẵn sàng!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 32px;">🎁 Voucher mới!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>Voucher của bạn đã sẵn sàng!</h2>
          <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <div style="font-size: 24px; font-weight: bold; color: #667eea; margin-bottom: 10px;">
              ${data.code}
            </div>
            <div style="font-size: 18px; color: #333;">
              Giảm ${data.discount?.toLocaleString('vi-VN')}₫
            </div>
          </div>
          <p style="font-size: 14px; color: #666;">
            Voucher có hiệu lực trong 30 ngày. Sử dụng ngay để nhận ưu đãi!
          </p>
          <a href="https://ket-noi-tri-thuc.myshopify.com" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px;">
            Mua sắm ngay
          </a>
        </div>
      </div>
    `
  }),
  
  new_book_release: (data) => ({
    subject: `📚 Sách mới: ${data.bookTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #667eea; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">📚 Sách mới phát hành!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>${data.bookTitle}</h2>
          ${data.bookImage ? `<img src="${data.bookImage}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 20px 0;">` : ''}
          <p style="font-size: 16px; line-height: 1.6;">
            ${data.description || 'Khám phá cuốn sách mới nhất của chúng tôi!'}
          </p>
          <a href="${data.link}" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px;">
            Xem chi tiết
          </a>
        </div>
      </div>
    `
  }),
  
  price_drop: (data) => ({
    subject: `💰 Giảm giá: ${data.productTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #e74c3c; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">💰 GIẢM GIÁ!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>${data.productTitle}</h2>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <div style="text-decoration: line-through; color: #999; font-size: 18px;">
              ${data.oldPrice?.toLocaleString('vi-VN')}₫
            </div>
            <div style="font-size: 28px; font-weight: bold; color: #e74c3c;">
              ${data.newPrice?.toLocaleString('vi-VN')}₫
            </div>
            <div style="color: #27ae60; font-size: 16px; margin-top: 10px;">
              Tiết kiệm ${((data.oldPrice - data.newPrice) / data.oldPrice * 100).toFixed(0)}%
            </div>
          </div>
          <a href="${data.link}" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #e74c3c; color: white; text-decoration: none; border-radius: 6px;">
            Mua ngay
          </a>
        </div>
      </div>
    `
  }),
  
  back_in_stock: (data) => ({
    subject: `✅ ${data.productTitle} đã có hàng trở lại!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #27ae60; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">✅ Đã có hàng!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>${data.productTitle}</h2>
          <p style="font-size: 16px; line-height: 1.6;">
            Sản phẩm bạn quan tâm đã có hàng trở lại! Nhanh tay đặt hàng trước khi hết.
          </p>
          <a href="${data.link}" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #27ae60; color: white; text-decoration: none; border-radius: 6px;">
            Đặt hàng ngay
          </a>
        </div>
      </div>
    `
  }),
  
  new_review: (data) => ({
    subject: `⭐ Review mới cho "${data.productTitle}"`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f39c12; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">⭐ Review mới!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2>${data.productTitle}</h2>
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <div style="color: #f39c12; font-size: 20px; margin-bottom: 10px;">
              ${'⭐'.repeat(data.rating || 5)}
            </div>
            <p style="font-style: italic; color: #666;">
              "${data.reviewText}"
            </p>
            <p style="font-size: 14px; color: #999; margin-top: 10px;">
              - ${data.reviewerName}
            </p>
          </div>
          <a href="${data.link}" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #f39c12; color: white; text-decoration: none; border-radius: 6px;">
            Xem tất cả reviews
          </a>
        </div>
      </div>
    `
  }),
  
  promotion: (data) => ({
    subject: `🎉 ${data.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">🎉 ${data.title}</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p style="font-size: 18px; line-height: 1.6;">
            ${data.message}
          </p>
          ${data.code ? `
            <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <div style="font-size: 14px; color: #666; margin-bottom: 5px;">Mã giảm giá:</div>
              <div style="font-size: 24px; font-weight: bold; color: #667eea;">
                ${data.code}
              </div>
            </div>
          ` : ''}
          <a href="${data.link || 'https://ket-noi-tri-thuc.myshopify.com'}" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px;">
            Mua sắm ngay
          </a>
        </div>
      </div>
    `
  }),
  
  update_info: (data) => ({
    subject: `📝 Cập nhật thông tin tài khoản`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #3498db; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">📝 Cập nhật thông tin</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p style="font-size: 16px; line-height: 1.6;">
            Xin chào! Chúng tôi nhận thấy thông tin tài khoản của bạn chưa đầy đủ.
          </p>
          <p style="font-size: 16px; line-height: 1.6;">
            Vui lòng cập nhật để nhận được trải nghiệm tốt nhất và các ưu đãi độc quyền!
          </p>
          <a href="https://ket-noi-tri-thuc.myshopify.com/account" 
             style="display: inline-block; margin-top: 20px; padding: 12px 30px; background: #3498db; color: white; text-decoration: none; border-radius: 6px;">
            Cập nhật ngay
          </a>
        </div>
      </div>
    `
  }),
  
  maintenance: (data) => ({
    subject: `🔧 Thông báo bảo trì hệ thống`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #95a5a6; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0;">🔧 Bảo trì hệ thống</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <p style="font-size: 16px; line-height: 1.6;">
            ${data.message || 'Hệ thống sẽ được bảo trì để nâng cấp trải nghiệm cho bạn.'}
          </p>
          ${data.startTime ? `
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <strong>Thời gian:</strong> ${data.startTime} - ${data.endTime || 'Hoàn tất'}
            </div>
          ` : ''}
          <p style="font-size: 14px; color: #666;">
            Cảm ơn bạn đã thông cảm!
          </p>
        </div>
      </div>
    `
  })
};

// ===== SEND EMAIL =====
async function sendEmail(customerEmail, subject, htmlContent) {
  try {
    console.log(`📧 [EMAIL] To: ${customerEmail}`);
    console.log(`📧 [EMAIL] Subject: ${subject}`);
    console.log(`📧 [EMAIL] HTML length: ${htmlContent.length} chars`);
    
    // TODO: Integrate với email service
    // Option 1: SendGrid
    // Option 2: Mailgun  
    // Option 3: Nodemailer + Gmail
    
    // Placeholder - sẽ implement sau
    return { success: true };
  } catch (error) {
    console.error('❌ Email send error:', error);
    return { success: false, error: error.message };
  }
}

// ===== GET CUSTOMER EMAIL =====
async function getCustomerEmail(customerId) {
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        email
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
  
  return data.data.customer;
}

// ===== SEND NOTIFICATION - UPDATED WITH EMAIL =====
async function sendNotification(customerId, { type, title, message, link = null, data = {} }) {
  try {
    // 1. Get customer metafields
    const customer = await getCustomerMetafields(customerId);
    
    // 2. Get history and preferences
    let history = { notifications: [] };
    let preferences = { channels: { in_app: true, email: true }, types: {} };
    
    if (customer.metafields?.loyalty_notifications?.history) {
      history = JSON.parse(customer.metafields.loyalty_notifications.history);
    }
    
    if (customer.metafields?.loyalty_notifications?.preferences) {
      preferences = JSON.parse(customer.metafields.loyalty_notifications.preferences);
    }
    
    // 3. Check preferences
    if (preferences.types[type] === false) {
      console.log(`⏭️ Customer ${customerId} disabled ${type} notifications`);
      return { success: false, message: 'User disabled this notification type' };
    }
    
    // 4. Create notification
    const newNotif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      link
    };
    
    // 5. Add to history
    history.notifications.unshift(newNotif);
    if (history.notifications.length > 50) {
      history.notifications = history.notifications.slice(0, 50);
    }
    
    // 6. Calculate unread count
    const unreadCount = history.notifications.filter(n => !n.read).length;
    
    // 7. Update metafields
    await updateCustomerMetafields(customerId, {
      'loyalty_notifications.history': JSON.stringify(history),
      'loyalty_notifications.unread_count': unreadCount,
      'loyalty_notifications.last_notification_sent': new Date().toISOString()
    });
    
    // 8. Send email if enabled
    if (preferences.channels.email !== false && EMAIL_TEMPLATES[type]) {
      const template = EMAIL_TEMPLATES[type]({ ...data, title, message, link });
      
      // Get customer email
      const customerData = await getCustomerEmail(customerId);
      if (customerData && customerData.email) {
        await sendEmail(customerData.email, template.subject, template.html);
      }
    }
    
    console.log(`✅ Notification sent: "${title}" to customer ${customerId}`);
    return { success: true, notification: newNotif };
    
  } catch (error) {
    console.error('❌ Notification error:', error);
    return { success: false, error: error.message };
  }
}

// ===== MARK ALL READ =====
async function markAllRead(customerId) {
  try {
    const customer = await getCustomerMetafields(customerId);
    
    if (!customer.metafields?.loyalty_notifications?.history) {
      return { success: true, message: 'No notifications' };
    }
    
    const history = JSON.parse(customer.metafields.loyalty_notifications.history);
    
    history.notifications.forEach(n => n.read = true);
    
    await updateCustomerMetafields(customerId, {
      'loyalty_notifications.history': JSON.stringify(history),
      'loyalty_notifications.unread_count': 0
    });
    
    console.log(`✅ Marked all notifications as read for customer ${customerId}`);
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error marking all read:', error);
    return { success: false, error: error.message };
  }
}

// ===== MARK AS READ =====
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
    console.error('❌ Error marking as read:', error);
    return { success: false, error: error.message };
  }
}

// ===== GET CUSTOMER METAFIELDS =====
async function getCustomerMetafields(customerId) {
  const query = `
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        id
        email
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
  
  return { id: customer.id, email: customer.email, metafields };
}

// ===== UPDATE CUSTOMER METAFIELDS =====
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
  
  // Reuse from loyaltytasks.js
  return await metafieldsSetPayload(metafieldsArray);
}

// ===== EXPORTS =====
module.exports = {
  sendNotification,
  markAllRead,
  markAsRead,
  EMAIL_TEMPLATES
};
