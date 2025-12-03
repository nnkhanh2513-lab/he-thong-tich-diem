const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Cấu hình Shopify
const SHOPIFY_CONFIG = {
  domain: 'ket-noi-tri-thuc.myshopify.com',
  token: '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',  // ← Token đúng
  apiVersion: '2024-10'
};


// Hàm gọi Shopify API
async function shopifyAPI(endpoint, method = 'GET', body = null) {
  const url = `https://${SHOPIFY_CONFIG.domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_CONFIG.token,
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  return await response.json();
}

// Lấy metafield của khách hàng
async function getCustomerMetafield(customerId, namespace, key) {
  const data = await shopifyAPI(`/customers/${customerId}/metafields.json`);
  const metafield = data.metafields?.find(
    m => m.namespace === namespace && m.key === key
  );
  return metafield;
}

// Tạo/cập nhật metafield
async function updateCustomerMetafield(customerId, namespace, key, value, type) {
  return await shopifyAPI(
    `/customers/${customerId}/metafields.json`,
    'POST',
    {
      metafield: {
        namespace,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : value.toString(),
        type
      }
    }
  );
}

// Tạo dữ liệu lịch sử mẫu
async function addSampleHistory(customerId) {
  console.log('🌊 THÊM DỮ LIỆU LỊCH SỬ MẪU\n');
  
  const sampleHistory = [
    {
      type: 'earn',
      points: 10,
      taskId: 'login',
      taskName: 'Đăng nhập',
      timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 ngày trước
    },
    {
      type: 'earn',
      points: 30,
      taskId: 'read_pages',
      taskName: 'Đọc sách',
      timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() // 4 ngày trước
    },
    {
      type: 'earn',
      points: 20,
      taskId: 'collect_books',
      taskName: 'Săn sách',
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 ngày trước
    },
    {
      type: 'earn',
      points: 100,
      taskId: 'complete_order',
      taskName: 'Chốt đơn',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 ngày trước
    },
    {
      type: 'redeem',
      points: -100,
      voucherCode: 'BOOK1733123456789',
      voucherValue: 10000,
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 ngày trước
    },
    {
      type: 'earn',
      points: 20,
      taskId: 'play_game',
      taskName: 'Chơi trò chơi',
      timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() // 12 giờ trước
    },
    {
      type: 'earn',
      points: 10,
      taskId: 'browse_time',
      taskName: 'Dạo một vòng coi sách',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 giờ trước
    }
  ];
  
  console.log('📝 Tạo lịch sử với', sampleHistory.length, 'giao dịch...\n');
  
  // Kiểm tra metafield hiện tại
  const existingField = await getCustomerMetafield(customerId, 'loyalty', 'points_history');
  
  if (existingField) {
    console.log('⚠️  Đã có lịch sử cũ, sẽ ghi đè...\n');
  }
  
  // Lưu lịch sử mẫu
  const result = await updateCustomerMetafield(
    customerId,
    'loyalty',
    'points_history',
    sampleHistory,
    'json'
  );
  
  if (result.metafield) {
    console.log('✅ ĐÃ THÊM LỊCH SỬ MẪU THÀNH CÔNG!\n');
    console.log('📊 Tổng quan:');
    
    let totalEarned = 0;
    let totalRedeemed = 0;
    
    sampleHistory.forEach(item => {
      if (item.type === 'earn') {
        totalEarned += item.points;
        console.log(`  ✅ ${item.taskName}: +${item.points} điểm`);
      } else {
        totalRedeemed += Math.abs(item.points);
        console.log(`  🎁 Đổi voucher ${item.voucherCode}: ${item.points} điểm (${item.voucherValue.toLocaleString('vi-VN')}₫)`);
      }
    });
    
    console.log('\n📈 Thống kê:');
    console.log(`  Tổng điểm kiếm được: ${totalEarned}`);
    console.log(`  Tổng điểm đã đổi: ${totalRedeemed}`);
    console.log(`  Còn lại: ${totalEarned - totalRedeemed}`);
    
    console.log('\n🌊 Bây giờ reload trang dashboard để xem lịch sử!');
  } else {
    console.log('❌ LỖI:', result);
  }
}

// Chạy
const customerId = '8105337946248'; // ID khách hàng của bạn
addSampleHistory(customerId);
