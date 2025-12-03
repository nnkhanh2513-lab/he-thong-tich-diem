const fetch = require('node-fetch');

async function testRedeem() {
  try {
    console.log('🧪 Đang test đổi voucher...\n');
    
    const response = await fetch('http://localhost:3000/api/redeem-voucher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: '8105337946248',
        pointsToRedeem: 50
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ ĐỔI VOUCHER THÀNH CÔNG!\n');
      console.log('💳 Mã voucher:', result.voucher.code);
      console.log('💰 Giá trị:', result.voucher.discountValue, 'VND');
      console.log('📅 Hết hạn:', result.voucher.expiresAt);
      console.log('📊 Điểm còn lại:', result.remainingPoints);
    } else {
      console.log('❌ LỖI:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Lỗi kết nối:', error.message);
  }
}

testRedeem();
