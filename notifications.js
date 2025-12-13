// notifications.js - Backend endpoints
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Cấu hình email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Helper: Lưu notification vào metafield
async function saveNotification(customerId, notification) {
  const customer = await shopify.customer.get(customerId);
  const history = customer.metafields?.loyalty_notifications?.history?.value || { notifications: [] };
  
  history.notifications.unshift({
    id: Date.now(),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    timestamp: new Date().toISOString(),
    read: false
  });
  
  // Giữ tối đa 50 thông báo
  if (history.notifications.length > 50) {
    history.notifications = history.notifications.slice(0, 50);
  }
  
  const unreadCount = history.notifications.filter(n => !n.read).length;
  
  await shopify.metafield.create({
    key: 'history',
    value: JSON.stringify(history),
    type: 'json',
    namespace: 'loyalty_notifications',
    owner_id: customerId,
    owner_resource: 'customer'
  });
  
  await shopify.metafield.create({
    key: 'unread_count',
    value: unreadCount.toString(),
    type: 'number_integer',
    namespace: 'loyalty_notifications',
    owner_id: customerId,
    owner_resource: 'customer'
  });
}

// Helper: Gửi email
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"${process.env.STORE_NAME}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
}

// 1. THÔNG BÁO HÀNG SẮP HẾT / CÓ HÀNG TRỞ LẠI
router.post('/inventory-alert', async (req, res) => {
  try {
    const { productId, variantId, type } = req.body; // type: 'low_stock' hoặc 'back_in_stock'
    
    const product = await shopify.product.get(productId);
    const variant = product.variants.find(v => v.id == variantId);
    
    // Lấy danh sách khách hàng đã đăng ký nhận thông báo sản phẩm này
    const customers = await getCustomersWatchingProduct(productId);
    
    for (const customer of customers) {
      const notification = {
        type,
        title: type === 'back_in_stock' ? 'Sản phẩm đã có hàng trở lại!' : 'Sản phẩm sắp hết hàng',
        message: `${product.title}${variant.title !== 'Default Title' ? ' - ' + variant.title : ''} ${type === 'back_in_stock' ? 'đã có hàng trở lại' : 'chỉ còn ít hàng'}.`
      };
      
      await saveNotification(customer.id, notification);
      
      const emailHtml = `
        <h2>${notification.title}</h2>
        <p>${notification.message}</p>
        <a href="${process.env.STORE_URL}/products/${product.handle}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;margin-top:16px;">Xem sản phẩm</a>
      `;
      
      await sendEmail(customer.email, notification.title, emailHtml);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 2. THÔNG BÁO YÊU CẦU CẬP NHẬT THÔNG TIN
router.post('/request-update-info', async (req, res) => {
  try {
    const { customerId } = req.body;
    const customer = await shopify.customer.get(customerId);
    
    const notification = {
      type: 'update_info',
      title: 'Vui lòng cập nhật thông tin',
      message: 'Để nhận được ưu đãi tốt nhất, vui lòng hoàn thiện thông tin tài khoản của bạn.'
    };
    
    await saveNotification(customerId, notification);
    
    const emailHtml = `
      <h2>${notification.title}</h2>
      <p>${notification.message}</p>
      <a href="${process.env.STORE_URL}/account" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;margin-top:16px;">Cập nhật ngay</a>
    `;
    
    await sendEmail(customer.email, notification.title, emailHtml);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 3. THÔNG BÁO BẢO TRÌ VÀ CẬP NHẬT WEB
router.post('/maintenance-notice', async (req, res) => {
  try {
    const { title, message, scheduledTime } = req.body;
    
    // Lấy tất cả khách hàng
    const customers = await shopify.customer.list({ limit: 250 });
    
    const notification = {
      type: 'maintenance',
      title: title || 'Thông báo bảo trì hệ thống',
      message: message || `Website sẽ tạm ngưng hoạt động vào ${scheduledTime} để bảo trì và nâng cấp.`
    };
    
    for (const customer of customers) {
      await saveNotification(customer.id, notification);
      
      const emailHtml = `
        <h2>${notification.title}</h2>
        <p>${notification.message}</p>
        <p style="color:#666;font-size:14px;margin-top:16px;">Cảm ơn bạn đã thông cảm!</p>
      `;
      
      await sendEmail(customer.email, notification.title, emailHtml);
    }
    
    res.json({ success: true, sent: customers.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 4. ĐÁNH DẤU ĐÃ ĐỌC
router.post('/mark-all-read', async (req, res) => {
  try {
    const { customerId } = req.body;
    const customer = await shopify.customer.get(customerId);
    const history = customer.metafields?.loyalty_notifications?.history?.value || { notifications: [] };
    
    history.notifications.forEach(n => n.read = true);
    
    await shopify.metafield.create({
      key: 'history',
      value: JSON.stringify(history),
      type: 'json',
      namespace: 'loyalty_notifications',
      owner_id: customerId,
      owner_resource: 'customer'
    });
    
    await shopify.metafield.create({
      key: 'unread_count',
      value: '0',
      type: 'number_integer',
      namespace: 'loyalty_notifications',
      owner_id: customerId,
      owner_resource: 'customer'
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
