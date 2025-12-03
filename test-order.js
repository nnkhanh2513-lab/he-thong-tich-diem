const API = require('./loyaltytasks.js');

async function testOrder() {
  const customerId = '8105337946248';
  const orderId = '6346581966984';
  
  console.log('=== TEST CỘNG ĐIỂM CHO ĐƠN HÀNG ===\n');
  
  // Xem điểm trước khi cộng
  API.clearCache(customerId);
  let progress = await API.getProgress(customerId);
  console.log('Trước khi chốt đơn:');
  console.log('Tổng điểm:', progress.points);
  console.log('');
  
  // Cộng điểm cho đơn hàng
  console.log('Đang cộng điểm cho đơn hàng #6346581966984...');
  const result = await API.trackOrder(customerId, orderId);
  console.log(result.message);
  console.log('');
  
  // Xem điểm sau khi cộng
  API.clearCache(customerId);
  progress = await API.getProgress(customerId);
  console.log('Sau khi chốt đơn:');
  console.log('Tổng điểm:', progress.points);
  console.log('');
  
  console.log('Các gói điểm:');
  progress.pointsBatches.forEach((batch, i) => {
    console.log(`  Gói ${i+1}: ${batch.points} điểm - Còn ${batch.daysLeft} ngày`);
  });
}

testOrder();
