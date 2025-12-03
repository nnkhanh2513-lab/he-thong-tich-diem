const API = require('./loyaltytasks.js');

async function testEarnPoints() {
  const customerId = '8105337946248';
  
  console.log('TEST KIẾM ĐIỂM\n');
  
  API.clearCache(customerId);
  
  try {
    console.log('1. Dạo xem 2 phút...');
    const browse = await API.trackBrowseTime(customerId, 2);
    console.log('   ', browse.message, `(Tổng: ${browse.points})`);
    console.log('   DEBUG:', JSON.stringify(browse, null, 2));
    
    console.log('\n2. Đọc 10 trang...');
    const read = await API.trackReadPages(customerId, 10);
    console.log('   ', read.message, `(Tổng: ${read.points})`);
    
    console.log('\n3. Săn 2 cuốn sách...');
    const collect = await API.trackCollectBooks(customerId, 2);
    console.log('   ', collect.message, `(Tổng: ${collect.points})`);
    
    console.log('\n4. Chơi game...');
    const game = await API.playGame(customerId, 100);
    console.log('   ', game.message, `(Tổng: ${game.points})`);
    
    console.log('\n=== HOÀN THÀNH ===');
    console.log('Tổng điểm:', game.points);
    
    // ĐỢI 2 GIÂY ĐỂ SHOPIFY LƯU XONG
    console.log('\nĐợi Shopify lưu dữ liệu...');
    await new Promise(r => setTimeout(r, 2000));
    
    API.clearCache(customerId);
    const progress = await API.getProgress(customerId);
    console.log('\nKiểm tra lại từ Shopify:');
    console.log('Tổng điểm:', progress.points);
    console.log('Số gói:', progress.pointsBatches.length);
    
    if (progress.pointsBatches.length > 0) {
      console.log('\nCác gói điểm:');
      progress.pointsBatches.forEach((batch, i) => {
        console.log(`  Gói ${i+1}: ${batch.points} điểm - Còn ${batch.daysLeft} ngày`);
      });
    } else {
      console.log('\n❌ CẢNH BÁO: Không có gói điểm nào được lưu!');
    }
    
  } catch (error) {
    console.error('\n❌ LỖI:', error.message);
    console.error(error.stack);
  }
}

testEarnPoints();
