const mineflayer = require('mineflayer');
const readline   = require('readline');
const https       = require('https');
const { URL }      = require('url');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
// CONFIG
const HOST     = 'mc.minerua.com';
const PORT     = 25565;
const VERSION  = '1.21.4';
const USERNAME = '_BachPremium'; 
const PASSWORD = 'TaoLaTraiDep';

const CMD_VO_DUNGEON = '/warp dungeon1';

// ============================================================
//  DISCORD WEBHOOK - tự động gửi bảng "Status" mỗi khi chat server có dòng
//  chứa "Tiêu diệt BOSS" (kèm bảng xếp hạng % sát thương phía dưới).
// ============================================================
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1540786913093492852/clUnhU2H1PFJ8_tZI0D1CUq8z3lX5xUBn4wQLtSY8fqbT9yyKDXpllEaQZetnQB_a8Uk';
const THOI_GIAN_CHO_DONG_XEP_HANG_MS = 2000;
const REGEX_TIEU_DIET_BOSS = /Tiêu diệt BOSS/i;
const REGEX_DONG_XEP_HANG = /^\d+\.\s*\S.*\(\d+(?:[.,]\d+)?%\)/;
const COOLDOWN_THEO_LENH_MS = {
  '/warp':  5250, // /warp dungeon1
  '/taf':   5250, // /taf
  '/tpa':   3000, // /tpa
  '/is':    0,    // /is 
  '/bal':   0,    // /bal
  '/sky':   0,    // /sky
  '/login': 0,    // /login
};
const COOLDOWN_MAC_DINH_MS = 1000;
const KHOANG_CACH_TOI_THIEU_MOI_LENH_MS = 300;
const THOI_GIAN_DUNG_YEN_SAU_WARP_MS = 2500;
const BAN_KINH_TIM_QUAI = 20;
const BAN_KINH_TIM_BOSS = 28;
const NGUONG_NE_BOSS_PHAN_TRAM = 40;
const NGUONG_QUAY_LAI_BOSS_PHAN_TRAM = 60;
const KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE = 3;
const TEN_DEN_ECH = ['ochre_froglight', 'verdant_froglight', 'pearlescent_froglight'];
const BAN_KINH_TIM_DEN_ECH = 64;
const KHOANG_CACH_DUNG_CANH_DEN_ECH = 1; // đứng cách đèn ếch xa nhất 1 block
const TD = 459 * 0.0003; // = 0.1377 -> đổi 459 thành cấp thật hiện tại của bạn
const SLOT_KIEM = 0;
const C = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m', white: '\x1b[37m', reset: '\x1b[0m' };
process.on('uncaughtException', err => { if (err.code !== 'EPIPE' && err.name !== 'PartialReadError') console.error('Lỗi:', err.message); });
process.on('unhandledRejection', r => {});
const sleep = ms => new Promise(res => setTimeout(res, ms));
const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
let activeBot = null;
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', l => { if (l.trim() && activeBot) activeBot.chat(l.trim()); });
function startBot(delay = 0) {
  setTimeout(() => {
    console.log(`[${USERNAME}] Start Lite...`);

    const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USERNAME, version: VERSION, auth: 'offline', checkTimeoutInterval: 60000, keepAlive: true, hideErrors: true });
    bot.loadPlugin(pathfinder);
    activeBot = bot;
    bot.setMaxListeners(50);

    let done = false, guiBusy = false, phase = 'init', ignoreChat = false;
    let balInt = null;
    let farmActive = false;             // vòng farm đang chạy hay không
    let coThongBaoThucTinh = false;     // đã thấy dòng "Hãy hoàn thành thức tỉnh..." chưa
    let dangXuLySuKienDungeon = false;  // chặn xử lý trùng khi 1 thông báo in ra nhiều dòng

    // --- Trạng thái riêng cho pha "Bảo vệ trái tim của hầm ngục" (boss bar) ---
    let dangBaoVeTraiTim = false;       
    let dangXuLyBaoVeTraiTim = false;   
    let viTriDenEchHienTai = null;

    let vaTocDoInt = null;
    let tpaCheckInt = null;
    let tafCheckInt = null;
    let vatCamTayInt = null;
    let epSlotKiemInt = null;
    let mauCheckInt = null; 
    let giuKhoangCachBossInt = null; 
    let dangChayXaBoss = false;      
    let mucTieuDangDanh = null;      

    
    let dangThuThapBangXepHang = false; 
    let dongTieuDeBangXepHang = null;   
    let cacDongXepHang = [];            
    let thuThapBangXepHangTimeout = null; 
    let dangXuLyBiKickDungeon = false;
    let dangXuLyBatTaf = false;
    let dangSong = true;          
    let dangTrongKhoiDong = false; 
    let dangNeBossViMauThap = false; 

    const log = msg => {
      let mau = C.cyan;
      if (/lỗi|error|recon/i.test(msg)) mau = C.red;
      else if (/cảnh báo|warning|chưa thấy quái|không có/i.test(msg)) mau = C.yellow;
      else if (/=== khởi động ===|bắt đầu farm|đã có quái|phát hiện|đã hồi sinh/i.test(msg)) mau = C.green;
      console.log(`${mau}[${USERNAME}] ${msg}${C.reset}`);
    };

    const hangDoiLenh = [];
    let dangXuLyHangDoi = false;
    let lanCuoiGuiLenhBatKy = 0;      // mốc thời gian gửi lệnh gần nhất (bất kỳ loại nào)
    const lanCuoiGuiTheoLoai = {};   // khoá lệnh ('/warp', '/taf'...) -> mốc thời gian gửi gần nhất

    function layKhoaLenh(cmd) {
      const tu = cmd.trim().split(/\s+/)[0] || '';
      return tu.toLowerCase();
    }

    function guiLenh(cmd) {
      hangDoiLenh.push(cmd);
      xuLyHangDoiLenh();
    }

    async function xuLyHangDoiLenh() {
      if (dangXuLyHangDoi) return;
      dangXuLyHangDoi = true;
      while (hangDoiLenh.length > 0) {
        if (done) { hangDoiLenh.length = 0; break; }

        const cmd = hangDoiLenh[0]; // chỉ xem trước, chưa lấy ra khỏi hàng đợi
        const khoa = layKhoaLenh(cmd);
        const cooldownRieng = Object.prototype.hasOwnProperty.call(COOLDOWN_THEO_LENH_MS, khoa)
          ? COOLDOWN_THEO_LENH_MS[khoa]
          : COOLDOWN_MAC_DINH_MS;

        const daTroiQuaTheoLoai = Date.now() - (lanCuoiGuiTheoLoai[khoa] || 0);
        const daTroiQuaBatKy = Date.now() - lanCuoiGuiLenhBatKy;

        const canCho = Math.max(
          cooldownRieng - daTroiQuaTheoLoai,               // chờ đủ cooldown riêng của loại lệnh này
          KHOANG_CACH_TOI_THIEU_MOI_LENH_MS - daTroiQuaBatKy, // chờ giãn cách tối thiểu chống dính gói
          0
        );

        if (canCho > 0) await sleep(canCho);
        if (done) break;

        hangDoiLenh.shift();
        try { bot.chat(cmd); } catch (e) {}

        const luc = Date.now();
        lanCuoiGuiTheoLoai[khoa] = luc;
        lanCuoiGuiLenhBatKy = luc;
      }
      dangXuLyHangDoi = false;
    }

    function recon(rsn) {
      if (done) return;
      done = true;
      if (balInt) clearInterval(balInt);
      if (vaTocDoInt) clearInterval(vaTocDoInt);
      if (tpaCheckInt) clearInterval(tpaCheckInt);
      if (tafCheckInt) clearInterval(tafCheckInt);
      if (vatCamTayInt) clearInterval(vatCamTayInt);
      if (epSlotKiemInt) clearInterval(epSlotKiemInt);
      if (mauCheckInt) clearInterval(mauCheckInt);
      if (giuKhoangCachBossInt) clearInterval(giuKhoangCachBossInt);
      if (thuThapBangXepHangTimeout) clearTimeout(thuThapBangXepHangTimeout);
      hangDoiLenh.length = 0;
      activeBot = null;
      log(`Recon: ${rsn}`);
      try { bot.end(); } catch(_) {}
      bot.removeAllListeners();
      if (bot._client) bot._client.removeAllListeners();
      startBot(2000);
    }

    async function joinSky() {
      return new Promise(res => {
        phase = 'skyMenu';
        guiLenh('/sky');
        const h = async w => {
          if (phase !== 'skyMenu' || guiBusy) return;
          guiBusy = true;
          try {
            await sleep(rand(1000, 1400));
            await bot.clickWindow(13, 0, 0);
            phase = 'skyUpdated';
            await sleep(1500);
            if (bot.currentWindow && phase === 'skyUpdated') {
              await bot.clickWindow(19, 0, 0);
              phase = 'joined';
              await sleep(500);
              if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
              res();
            }
          } catch (e) { res(); } finally { guiBusy = false; }
        };
        bot.once('windowOpen', h);
        setTimeout(() => { bot.removeListener('windowOpen', h); res(); }, 15000);
      });
    }

    // ============================================================
    //  KHỞI ĐỘNG
    // ============================================================
    async function xuLyBiKickKhoiDungeon() {
      if (done || dangXuLyBiKickDungeon) return;
      if (!dangSong) {
        log('Đang chết/chờ hồi sinh -> bỏ qua "bị kick khỏi dungeon" (respawn sẽ tự lo Khởi Động lại).');
        return;
      }
      dangXuLyBiKickDungeon = true;
      log('Phát hiện bị kick khỏi dungeon (/tpa không bị chặn) -> Khởi Động lại (khoiDong() tự vô lại dungeon).');
      farmActive = false;
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      bot.clearControlStates();
      await khoiDong(); // khoiDong() đã tự gọi voDungeon() ở bước đầu, KHÔNG gọi voDungeon() ở đây nữa (tránh gửi /warp 2 lần)
      dangXuLyBiKickDungeon = false;
    }

    async function chuKyKiemTraTpa() {
      if (done) return;
      if (!dangSong) {
        log('Đang chết/chờ hồi sinh -> bỏ qua kiểm tra /tpa định kỳ lần này.');
        return;
      }
      log('Kiểm tra định kỳ: gửi /tpa.');
      guiLenh('/tpa');

      const coBiChan = await new Promise(resolve => {
        let xong = false;
        const h = msg => {
          if (xong) return;
          const clean = msg.toString().replace(/§[0-9a-fklmnor]/gi, '');
          if (clean.toLowerCase().includes("can't use /tpa")) {
            xong = true;
            bot.removeListener('message', h);
            resolve(true);
          }
        };
        bot.on('message', h);
        setTimeout(() => {
          if (xong) return;
          xong = true;
          bot.removeListener('message', h);
          resolve(false);
        }, 3000);
      });

      if (done) return;
      if (coBiChan) {
        log('Vẫn trong dungeon (bình thường).');
      } else {
        xuLyBiKickKhoiDungeon();
      }
    }

    async function xuLyBatTaf() {
      if (done || dangXuLyBatTaf) return;
      dangXuLyBatTaf = true;
      log('Phát hiện "TriggerBot đã tắt." trên chat -> gửi lại /taf triggerbot (hàng đợi tự chờ đủ cooldown /taf).');
      guiLenh('/taf triggerbot');
      dangXuLyBatTaf = false;
    }

    async function chuKyKiemTraTaf() {
      if (done) return;
      log('Kiểm tra định kỳ: gửi /taf autofarm.');
      guiLenh('/taf autofarm');

      const coBat = await new Promise(resolve => {
        let xong = false;
        const h = msg => {
          if (xong) return;
          const clean = msg.toString().replace(/§[0-9a-fklmnor]/gi, '');
          if (clean.includes('TriggerBot đã tắt.')) {
            xong = true;
            bot.removeListener('message', h);
            resolve(true);
          }
        };
        bot.on('message', h);
        setTimeout(() => {
          if (xong) return;
          xong = true;
          bot.removeListener('message', h);
          resolve(false);
        }, 3000);
      });

      if (done) return;
      if (!coBat) {
        log('Không thấy "TriggerBot đã tắt." sau /taf autofarm -> gửi lại /taf triggerbot (hàng đợi tự chờ đủ 5.25s vì cùng khoá /taf).');
        guiLenh('/taf triggerbot');
      }
    }
    
    function coTheEpSlotKiem() {
      return phase === 'khoiDong' || phase === 'farming';
    }

    function epVeSlotKiem(lyDo) {
      if (done || !coTheEpSlotKiem()) return;
      if (bot.quickBarSlot !== SLOT_KIEM) {
        log(`Tay chính bị đổi khỏi slot kiếm${lyDo ? ` (${lyDo})` : ''} -> ép lại slot ${SLOT_KIEM + 1}.`);
        try { bot.setQuickBarSlot(SLOT_KIEM); } catch (e) {}
      }
    }

    async function khoiDong() {
      if (done || dangTrongKhoiDong) {
        log('Bỏ qua gọi Khởi Động vì đã có 1 luồng Khởi Động khác đang chạy (tránh gửi /warp trùng lặp).');
        return;
      }
      dangTrongKhoiDong = true;
      try {
      phase = 'khoiDong';
      log('=== KHỞI ĐỘNG ===');

      try { bot.setQuickBarSlot(SLOT_KIEM); } catch (e) {} // luôn cầm vũ khí ở slot 1 hotbar

      bot.physics.enabled = true;
      try {
        const movements = new Movements(bot);
        movements.allowSprinting = true;   // chạy (sprint) thay vì đi bộ thường -> đúng tốc độ tối đa
        movements.allowParkour = true;     // cho phép nhảy qua vật cản/hố nhỏ khi di chuyển
        movements.canDig = false;          // KHÔNG cho đào khối -> tránh bot tự đổi tay cầm sang cuốc/xẻng/rìu...
        movements.scafoldingBlocks = [];   // KHÔNG cho đặt khối để bắc cầu -> tránh bot tự cầm khối trong túi lên tay
        bot.pathfinder.setMovements(movements);
      } catch (e) {}

      // Bật sprint 1 lần, giữ nguyên suốt phiên
      bot.setControlState('sprint', true);

      if (!tpaCheckInt) {
        tpaCheckInt = setInterval(() => { if (!done) chuKyKiemTraTpa(); }, 30000);
      }
      if (!tafCheckInt) {
        tafCheckInt = setInterval(() => { if (!done) chuKyKiemTraTaf(); }, 60000);
      }
      if (!vatCamTayInt) {
        vatCamTayInt = setInterval(() => {
          if (done) return;
          epVeSlotKiem('kiểm tra định kỳ');
          const item = bot.heldItem;
          log(`Tay chính đang cầm: ${item ? `${item.name} x${item.count}` : 'trống'}.`);
        }, 60000);
      }
      if (!epSlotKiemInt) {
        // Ép liên tục, không chờ sự kiện heldItemChanged, phòng trường hợp
        // server tự đổi slot mà không bắn sự kiện đó cho client.
        epSlotKiemInt = setInterval(() => { epVeSlotKiem(); }, 2000);
      }
      if (!mauCheckInt) {
        // Kiểm tra % máu LIÊN TỤC mỗi giây - độc lập hoàn toàn với việc bot
        // đang đánh quái, đang đi tìm quái, hay đang đứng chờ. Nhờ vậy trạng
        // thái né BOSS / quay lại đánh BOSS luôn được cập nhật kịp thời,
        // không phải chờ tới lượt farmLoop hay tới nhịp đánh mới check.
        mauCheckInt = setInterval(() => { if (!done) neTranhBossHienTai(); }, 1000);
      }
      if (!giuKhoangCachBossInt) {
        // Ép giữ khoảng cách an toàn với BOSS LIÊN TỤC (mỗi 400ms), bất kể
        // đang chém quái khác hay đang đứng yên - không phải check 1 lần.
        giuKhoangCachBossInt = setInterval(() => { if (!done) capNhatChayXaBossNeuCan(); }, 400);
      }

      await voDungeon();       // vô dungeon lần đầu (/warp dungeon1)
      guiLenh('/taf triggerbot');
      await sleep(rand(1500, 2000));
      coThongBaoThucTinh = false; // reset 1 lần khi mới vô, không reset mỗi vòng lặp

      let coQuai = false;

      while (!done && !coQuai) {
        await sleep(1000);
        await nhaySoTaiCho(1500);
        const neTranhBoss = neTranhBossHienTai();
        const bossGanNhat = neTranhBoss ? null : timBossGanNhat(BAN_KINH_TIM_BOSS);
        const quaiGanNhat = bossGanNhat || timQuaiGanNhat(BAN_KINH_TIM_QUAI);

        if (!quaiGanNhat) {
          log('Chưa thấy quái, chọn hướng đi tìm...');
          const timThay = await diChuyenNgauNhienVaTimQuai(5000);

          if (timThay) {
            coQuai = true;
            log('Đã phát hiện quái!');
          } else {
            log('Không có quái, vô lại dungeon...');
            await voDungeon();
            coThongBaoThucTinh = false; // reset lại vì vừa vô ải mới
          }
        } else {
          coQuai = true;
          if (bossGanNhat) {
            log(`Phát hiện BOSS (${getTenTuyChinh(bossGanNhat)}) ngay từ đầu -> ưu tiên bắt đầu farm!`);
          } else {
            log(`Đã có quái sẵn (${getTenTuyChinh(quaiGanNhat) || quaiGanNhat.name || quaiGanNhat.type}), bắt đầu farm!`);
          }
        }
      }

      if (!done) batDauFarm();
      } finally {
        dangTrongKhoiDong = false;
      }
    }

    async function nhaySoTaiCho(thoiGian) {
      bot.clearControlStates();
      const ketThuc = Date.now() + thoiGian;
      while (Date.now() < ketThuc && !done) {
        bot.setControlState('jump', true);
        await sleep(200);
        bot.setControlState('jump', false);
        await sleep(150);
      }
      bot.setControlState('jump', false);
    }

    async function diChuyenNgauNhienVaTimQuai(thoiGian) {
      if (!bot.entity) return false;

      const goc = Math.random() * Math.PI * 2;
      const diemNhin = bot.entity.position.offset(Math.cos(goc) * 20, 0, Math.sin(goc) * 20);

      try { bot.lookAt(diemNhin, true); } catch (e) {}
      bot.setControlState('forward', true);

      const ketThuc = Date.now() + thoiGian;
      let quaiTimThay = null;

      while (Date.now() < ketThuc && !done) {
        await sleep(300);
        // Ưu tiên BOSS mỗi lần quét, trừ khi đang né vì máu thấp.
        quaiTimThay = neTranhBossHienTai() ? null : timBossGanNhat(BAN_KINH_TIM_BOSS);
        if (!quaiTimThay) quaiTimThay = timQuaiGanNhat(BAN_KINH_TIM_QUAI);
        if (quaiTimThay) break;
      }

      bot.setControlState('forward', false);

      if (quaiTimThay) {
        await diChuyenToiVaDanhQuai(quaiTimThay);
        return true;
      }
      return false;
    }

    // Việc gửi lệnh /warp giờ đi qua guiLenh() nên đã tự động chờ đủ
    // cooldown riêng của khoá '/warp' (COOLDOWN_THEO_LENH_MS['/warp']),
    // không cần tự canh cooldown thủ công ở đây nữa. Điều quan trọng còn
    // lại là: sau khi lệnh warp được gửi THẬT SỰ (tức đã tới lượt, không
    // còn nằm chờ trong hàng đợi), bot phải ĐỨNG YÊN một chút để server
    // không hủy yêu cầu dịch chuyển (dòng "Đừng di chuyển.").
    async function voDungeon() {
      if (done) return;

      log(`Vô dungeon (${CMD_VO_DUNGEON}).`);
      bot.clearControlStates();
      guiLenh(CMD_VO_DUNGEON);

      // Đứng yên tuyệt đối trong lúc chờ dịch chuyển bắt đầu, tránh bị
      // "Việc xử lý yêu cầu dịch chuyển đã bị hủy" do bot nhảy/di chuyển.
      await sleep(THOI_GIAN_DUNG_YEN_SAU_WARP_MS);
    }

    // ============================================================
    //  FARM
    // ============================================================

    async function batDauFarm() {
      if (done || farmActive) return;
      phase = 'farming';
      farmActive = true;
      log('Bắt đầu farm.');
      farmLoop();
    }

    async function farmLoop() {
      while (!done && farmActive) {
        const neTranhBoss = neTranhBossHienTai();
        const boss = neTranhBoss ? null : timBossGanNhat(BAN_KINH_TIM_BOSS);
        const mucTieu = boss || timQuaiGanNhat(BAN_KINH_TIM_QUAI);

        if (!mucTieu) {
          await sleep(300);
          continue;
        }

        if (boss) {
          log(`Phát hiện BOSS (${getTenTuyChinh(boss)}) -> chạy tới đánh ngay.`);
        }
        // (Không cần log lặp lại "đang né BOSS" mỗi lượt - hàm neTranhBossHienTai()
        // đã tự log 1 lần duy nhất ngay lúc chuyển trạng thái né/hết né.)

        await diChuyenToiVaDanhQuai(mucTieu, () => {
          if (!isBossEntity(mucTieu)) {
            // Đang đánh quái thường: chỉ chuyển qua BOSS nếu đủ máu.
            if (neTranhBossHienTai()) return false;
            return !!timBossGanNhat(BAN_KINH_TIM_BOSS);
          }
          // Đang đánh BOSS: nếu máu tụt xuống dưới ngưỡng giữa chừng -> rút lui ngay.
          if (neTranhBossHienTai()) {
            log(`Máu tụt xuống ${layMauHienTaiPhanTram().toFixed(0)}% giữa lúc đánh BOSS -> rút lui, tìm quái thường để hồi máu.`);
            return true;
          }
          return false;
        });

        await sleep(200);
      }
    }

    function layMauQuaTen(e) {
      const ten = getTenTuyChinh(e);
      if (!ten) return null;
      const m = ten.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (!m) return null;
      return { hienTai: parseFloat(m[1]), toiDa: parseFloat(m[2]) };
    }

    bot.on('entityDead', entity => {
      if (entity) entity.__daChet = true;
    });

    function quaiConSong(e) {
      if (!e) return false;
      if (e.__daChet) return false;
      if (!bot.entities[e.id]) return false;

      const mau = layMauQuaTen(e);
      if (mau) return mau.hienTai > 0;

      if (typeof e.health === 'number') return e.health > 0;

      return true;
    }

    async function diChuyenToiVaDanhQuai(quai, kiemTraHuyGiuaChung) {
      if (!quai) return;
      mucTieuDangDanh = quai; // để giuKhoangCachBossInt biết quay lại mục tiêu nào sau khi chạy né BOSS xong
      // Nếu đang chạy né BOSS thì KHÔNG ghi đè goal chạy trốn bằng goal đuổi
      // quái mới - cứ để giuKhoangCachBossInt toàn quyền điều khiển, nó sẽ tự
      // trả lại goal đuổi quái (đúng mucTieuDangDanh vừa gán ở trên) khi an toàn.
      if (!dangChayXaBoss) {
        try { bot.pathfinder.setGoal(new goals.GoalFollow(quai, 2), true); } catch (e) {}
      }

      const batDau = Date.now();

      while (!done && bot.entities[quai.id]) {
        if (kiemTraHuyGiuaChung && kiemTraHuyGiuaChung()) break;

        if (!quaiConSong(quai)) {
          // Đã bỏ log ở đây vì bị spam liên tục mỗi khi quái chết (xảy ra
          // rất thường xuyên trong lúc farm bình thường).
          break;
        }

        // luôn đảm bảo tay chính là kiếm trước mỗi nhịp đánh
        epVeSlotKiem('trước đòn đánh');

        // Đang chạy né BOSS (do đứng quá gần) -> ưu tiên an toàn, tạm hoãn
        // tấn công/đuổi theo quái lúc này, để giuKhoangCachBossInt toàn quyền
        // điều khiển việc chạy lùi. Khi đã an toàn nó sẽ tự trả lại goal.
        if (dangChayXaBoss) {
          await sleep(200);
          if (Date.now() - batDau > 20000) break;
          continue;
        }

        const khoangCach = bot.entity.position.distanceTo(quai.position);
        if (khoangCach <= 3.5) {
          try { bot.lookAt(quai.position.offset(0, 1.2, 0), true); } catch (e) {}
          bot.attack(quai);
          await sleep(450);
        } else {
          await sleep(400);
        }

        if (Date.now() - batDau > 20000) break;
      }

      if (mucTieuDangDanh === quai) mucTieuDangDanh = null;
      if (!dangChayXaBoss) {
        try { bot.pathfinder.setGoal(null); } catch (e) {}
      }
    }

    // ============================================================
    //  BOSS BAR: "Bảo vệ trái tim của hầm ngục"
    // ============================================================

    function laBossBarBaoVeTraiTim(bossBar) {
      try {
        let text = '';
        if (bossBar && bossBar.title) {
          text = typeof bossBar.title.toString === 'function'
            ? bossBar.title.toString()
            : chatComponentToText(bossBar.title);
        }
        return text.toLowerCase().includes('bảo vệ trái tim của hầm ngục');
      } catch (e) { return false; }
    }

    async function diToiDenEchGanNhat() {
      if (!bot.entity) return null;

      let mcData;
      try { mcData = require('minecraft-data')(bot.version); } catch (e) {
        log('Không load được minecraft-data để tra id đèn ếch.');
        return null;
      }

      const idsCanTim = TEN_DEN_ECH
        .map(ten => mcData.blocksByName[ten] && mcData.blocksByName[ten].id)
        .filter(id => id !== undefined);

      if (!idsCanTim.length) {
        log('Không nhận diện được block id của đèn ếch (kiểm tra lại tên block).');
        return null;
      }

      const khoi = bot.findBlock({
        matching: b => idsCanTim.includes(b.type),
        maxDistance: BAN_KINH_TIM_DEN_ECH
      });

      if (!khoi) {
        log('Không tìm thấy đèn ếch nào trong bán kính gần.');
        return null;
      }

      log(`Tìm thấy đèn ếch tại (${khoi.position.x}, ${khoi.position.y}, ${khoi.position.z}) -> di chuyển tới đứng cạnh (≤${KHOANG_CACH_DUNG_CANH_DEN_ECH} block).`);
      try {
        bot.pathfinder.setGoal(new goals.GoalNear(
          khoi.position.x, khoi.position.y, khoi.position.z,
          KHOANG_CACH_DUNG_CANH_DEN_ECH
        ));
      } catch (e) {}

      return khoi.position;
    }

    async function xuLyBaoVeTraiTim() {
      if (dangXuLyBaoVeTraiTim) return;
      dangXuLyBaoVeTraiTim = true;
      log('Boss bar: "Bảo vệ trái tim của hầm ngục" -> tạm dừng farm, tìm đèn ếch để đứng cạnh.');

      const dangFarmTruocDo = farmActive;
      farmActive = false;
      try { bot.pathfinder.setGoal(null); } catch (e) {}

      viTriDenEchHienTai = await diToiDenEchGanNhat();

      while (!done && dangBaoVeTraiTim) {
        if (viTriDenEchHienTai) {
          const kc = bot.entity.position.distanceTo(viTriDenEchHienTai);
          if (kc > KHOANG_CACH_DUNG_CANH_DEN_ECH + 2) {
            viTriDenEchHienTai = await diToiDenEchGanNhat();
          }
        } else {
          viTriDenEchHienTai = await diToiDenEchGanNhat();
        }
        await sleep(1000);
      }

      try { bot.pathfinder.setGoal(null); } catch (e) {}
      viTriDenEchHienTai = null;
      log('Hết pha "Bảo vệ trái tim của hầm ngục" -> quay lại farm.');
      dangXuLyBaoVeTraiTim = false;
      if (dangFarmTruocDo) batDauFarm();
    }

    function xuLyBossBarThayDoi(bossBar) {
      if (done) return;
      const canBaoVe = laBossBarBaoVeTraiTim(bossBar);
      if (canBaoVe && !dangBaoVeTraiTim) {
        dangBaoVeTraiTim = true;
        xuLyBaoVeTraiTim();
      } else if (!canBaoVe && dangBaoVeTraiTim) {
        dangBaoVeTraiTim = false;
      }
    }

    const LOAI_KHONG_PHAI_QUAI = new Set([
      'item', 'arrow', 'spectral_arrow', 'trident', 'snowball', 'egg',
      'experience_orb', 'experience_bottle', 'fishing_bobber', 'firework_rocket',
      'tnt', 'falling_block', 'item_frame', 'glow_item_frame', 'painting',
      'leash_knot', 'end_crystal', 'evoker_fangs', 'block_display',
      'item_display', 'text_display', 'marker', 'boat', 'chest_boat',
      'minecart', 'chest_minecart', 'lightning_bolt',
      'turtle'
    ]);

    function coTheLaQuai(e) {
      if (!e || e === bot.entity || !e.position) return false;
      if (e.type === 'player' || e.type === 'orb') return false;
      const ten = (e.name || '').toLowerCase();
      if (LOAI_KHONG_PHAI_QUAI.has(ten)) return false;
      return true;
    }

    function timQuaiGanNhat(banKinh = BAN_KINH_TIM_QUAI) {
      if (!bot.entity) return null;
      const ds = Object.values(bot.entities).filter(e => {
        if (!coTheLaQuai(e)) return false;
        return bot.entity.position.distanceTo(e.position) <= banKinh;
      });
      if (!ds.length) return null;
      ds.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      return ds[0];
    }

    function timBossGanNhat(banKinh = BAN_KINH_TIM_BOSS) {
      if (!bot.entity) return null;
      const ds = Object.values(bot.entities).filter(e => {
        if (!coTheLaQuai(e)) return false;
        if (!isBossEntity(e)) return false;
        return bot.entity.position.distanceTo(e.position) <= banKinh;
      });
      if (!ds.length) return null;
      ds.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      return ds[0];
    }

    function isBossEntity(e) {
      const ten = getTenTuyChinh(e).toUpperCase();
      return ten.includes('BOSS');
    }

    // Tính % máu hiện tại của nhân vật, có xét max_health thật (nếu server
    // chỉnh attribute max_health khác 20 máu vanilla) chứ không cứng 20.
    function layMauHienTaiPhanTram() {
      if (!bot.entity || typeof bot.health !== 'number') return 100;
      const attrMauToiDa = bot.entity.attributes && bot.entity.attributes['minecraft:max_health'];
      const mauToiDa = (attrMauToiDa && attrMauToiDa.value > 0) ? attrMauToiDa.value : 20;
      if (mauToiDa <= 0) return 100;
      return (bot.health / mauToiDa) * 100;
    }

    // Có nên né BOSS lúc này không - CÓ ĐỘ TRỄ (hysteresis):
    // - Nếu đang KHÔNG né mà máu tụt xuống <= NGUONG_NE_BOSS_PHAN_TRAM -> bắt đầu né.
    // - Nếu đang né mà máu CHƯA hồi đủ NGUONG_QUAY_LAI_BOSS_PHAN_TRAM -> vẫn tiếp tục né.
    // - Chỉ hết né khi máu hồi lên >= NGUONG_QUAY_LAI_BOSS_PHAN_TRAM.
    // Nhờ vậy bot không bị nhấp nhô ra vào đánh BOSS liên tục quanh 1 mốc %,
    // mà sẽ né hẳn - đi hút máu - rồi mới quay lại đánh tiếp, lặp lại đến khi BOSS chết.
    function neTranhBossHienTai() {
      const mau = layMauHienTaiPhanTram();
      if (dangNeBossViMauThap) {
        if (mau >= NGUONG_QUAY_LAI_BOSS_PHAN_TRAM) {
          dangNeBossViMauThap = false;
          log(`Máu đã hồi lên ${mau.toFixed(0)}% (>= ${NGUONG_QUAY_LAI_BOSS_PHAN_TRAM}%) -> quay lại đánh BOSS.`);
        }
      } else {
        if (mau <= NGUONG_NE_BOSS_PHAN_TRAM) {
          dangNeBossViMauThap = true;
          log(`Máu còn ${mau.toFixed(0)}% (<= ${NGUONG_NE_BOSS_PHAN_TRAM}%) -> né BOSS, đánh quái thường để hồi máu.`);
        }
      }
      return dangNeBossViMauThap;
    }

    // Tìm BOSS gần nhất đang đứng gần hơn KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE.
    // LƯU Ý: hàm này CHỈ dùng máu THỰC TẾ tại thời điểm gọi (<= ngưỡng né),
    // KHÔNG dùng trạng thái "đang né" có độ trễ (dangNeBossViMauThap, vốn có
    // thể vẫn còn true tới tận lúc máu hồi 60%). Nhờ vậy việc ép chạy né chỉ
    // xảy ra đúng lúc máu thật sự <= 40%, không bị "gọi lung tung" khi máu
    // đã hồi trên 40% nhưng vẫn còn trong khoảng chờ 60% để đánh BOSS lại.
    function timBossQuaGanKhiNe() {
      if (!bot.entity) return null;
      if (layMauHienTaiPhanTram() > NGUONG_NE_BOSS_PHAN_TRAM) return null;
      const boss = timBossGanNhat(BAN_KINH_TIM_BOSS);
      if (!boss) return null;
      const kc = bot.entity.position.distanceTo(boss.position);
      return kc < KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE ? boss : null;
    }

    // Được gọi LIÊN TỤC (mỗi 400ms qua giuKhoangCachBossInt): nếu đang né
    // BOSS mà đứng quá gần, ép pathfinder chạy lùi ra xa ngay lập tức, ưu
    // tiên hơn cả việc đang chém quái khác. Khi đã đủ xa, trả lại quyền di
    // chuyển cho mục tiêu (quái thường) đang đánh dở, nếu còn tồn tại.
    function capNhatChayXaBossNeuCan() {
      if (done || !bot.entity) return;
      const bossQuaGan = timBossQuaGanKhiNe();

      if (bossQuaGan) {
        if (!dangChayXaBoss) {
          dangChayXaBoss = true;
          log(`Đang né BOSS nhưng đứng gần hơn ${KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE} khối -> chạy lùi ra xa ngay.`);
        }
        try {
          bot.pathfinder.setGoal(
            new goals.GoalInvert(new goals.GoalFollow(bossQuaGan, KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE)),
            true
          );
        } catch (e) {}
      } else if (dangChayXaBoss) {
        dangChayXaBoss = false;
        log(`Đã cách BOSS đủ xa (>= ${KHOANG_CACH_TOI_THIEU_VOI_BOSS_KHI_NE} khối) -> tiếp tục mục tiêu đang đánh (nếu còn).`);
        if (mucTieuDangDanh && bot.entities[mucTieuDangDanh.id]) {
          try { bot.pathfinder.setGoal(new goals.GoalFollow(mucTieuDangDanh, 2), true); } catch (e) {}
        } else {
          try { bot.pathfinder.setGoal(null); } catch (e) {}
        }
      }
    }

    function chatComponentToText(comp) {
      if (!comp) return '';
      if (typeof comp === 'string') return comp;
      let s = comp.text || '';
      if (Array.isArray(comp.extra)) s += comp.extra.map(chatComponentToText).join('');
      return s;
    }

    function getTenTuyChinh(e) {
      try {
        if (e.username) return e.username;

        if (Array.isArray(e.metadata)) {
          const raw2 = e.metadata[2];
          const val2 = (raw2 && typeof raw2 === 'object' && 'present' in raw2 && 'value' in raw2)
            ? (raw2.present ? raw2.value : null)
            : raw2;

          if (val2) {
            if (typeof val2 === 'string') {
              try {
                const parsed = JSON.parse(val2);
                const t = chatComponentToText(parsed);
                if (t.trim()) return t;
              } catch (_) {
                if (val2.trim()) return val2;
              }
            } else if (typeof val2 === 'object') {
              const t = chatComponentToText(val2);
              if (t.trim()) return t;
            }
          }

          for (const item of e.metadata) {
            if (!item) continue;
            if (typeof item === 'string' && item.trim()) return item;
            if (typeof item === 'object' && typeof item.text === 'string') {
              const t = chatComponentToText(item);
              if (t.trim()) return t;
            }
          }
        }
      } catch (err) {}
      return '';
    }

    // ============================================================
    //  LẤY TÊN HIỂN THỊ THẬT của vật phẩm đang cầm (vd "Kiếm mộc thanh"),
    //  KHÔNG phải id kỹ thuật (vd "diamond_sword"). Ưu tiên customName (tên
    //  đã đặt/rename thật của item, ở dạng JSON chat component hoặc chuỗi
    //  thường tuỳ phiên bản), nếu vật phẩm không có tên riêng thì mới dùng
    //  displayName mặc định (vẫn tốt hơn id thô).
    // ============================================================
    // Chuyển 1 thẻ NBT thô dạng {type, value} (kiểu dữ liệu server 1.20.5+
    // gửi về cho item component 'custom_name') thành giá trị JS thường:
    // chuỗi (string/number) hoặc object/array phẳng (compound/list), để
    // sau đó đưa qua chatComponentToText() lấy ra chữ hiển thị thật.
    function nbtTagSangPhang(tag) {
      if (tag === null || typeof tag !== 'object') return tag;
      if (!('type' in tag) || !('value' in tag)) return tag; // đã là giá trị thường rồi
      switch (tag.type) {
        case 'string':
        case 'byte': case 'short': case 'int': case 'long':
        case 'float': case 'double':
          return tag.value;
        case 'compound': {
          const out = {};
          for (const key in tag.value) out[key] = nbtTagSangPhang(tag.value[key]);
          return out;
        }
        case 'list': {
          const loaiPhanTu = tag.value && tag.value.type;
          const mang = (tag.value && tag.value.value) || [];
          if (!Array.isArray(mang)) return [];

          if (loaiPhanTu === 'compound') {
            // QUAN TRỌNG: mỗi phần tử trong list kiểu compound là 1 object
            // {key: thẻ_NBT_con} - KHÔNG có {type, value} bọc ngoài như thẻ
            // compound bình thường (vì kiểu đã biết trước từ chính list).
            // Đây chính là chỗ code cũ đọc sai -> ra "[object Object]".
            return mang.map(phanTu => {
              const out = {};
              for (const key in phanTu) out[key] = nbtTagSangPhang(phanTu[key]);
              return out;
            });
          }
          if (loaiPhanTu === 'list') {
            // list lồng list - từng phần tử là {type, value} của list con.
            return mang.map(phanTu => nbtTagSangPhang({ type: 'list', value: phanTu }));
          }
          // Phần tử kiểu nguyên thuỷ (string/int/...) -> đã là giá trị thô rồi.
          return mang;
        }
        default:
          return tag.value;
      }
    }

    // Thử bóc 1 giá trị (string hoặc object) ra thành chữ hiển thị thật,
    // dùng chung cho cả 2 đường: chuỗi JSON chat component / object phẳng.
    function boGiaTriRaChu(gt) {
      if (gt == null) return null;
      if (typeof gt === 'string') {
        try {
          const parsed = JSON.parse(gt);
          const t = chatComponentToText(parsed);
          if (t && t.trim()) return t.trim();
        } catch (_) {
          if (gt.trim()) return gt.trim();
        }
        return null;
      }
      if (typeof gt === 'object') {
        const t = chatComponentToText(gt);
        if (t && t.trim()) return t.trim();
      }
      return null;
    }

    function layTenVatPhamTuCustomName(item) {
      try {
        if (!item) return null;
        const raw = item.customName;
        if (raw === null || raw === undefined) return null;

        // Trường hợp 1: server cũ / nbt truyền thống -> raw là chuỗi
        // (thường là JSON chat component dạng chuỗi, đôi khi là text thường).
        if (typeof raw === 'string') {
          const ten = boGiaTriRaChu(raw);
          if (ten) return ten;
        }

        // Trường hợp 2: item component 1.20.5+ -> raw là thẻ NBT thô dạng
        // {type, value} (KHÔNG phải chuỗi JSON) -> phải phẳng hoá trước.
        if (typeof raw === 'object') {
          const phang = nbtTagSangPhang(raw);
          const ten = boGiaTriRaChu(phang);
          if (ten) return ten;
        }
      } catch (e) {}
      return null;
    }

    function layTenTayChinhHienTai() {
      const item = bot.heldItem;
      if (!item) return 'Tay không';
      const tenTuyChinh = layTenVatPhamTuCustomName(item);
      if (tenTuyChinh) return tenTuyChinh;
      return item.displayName || item.name || 'Không rõ';
    }

    // ============================================================
    //  GỬI DISCORD WEBHOOK
    // ============================================================
    function guiDiscordWebhook(payload) {
      return new Promise(resolve => {
        if (!DISCORD_WEBHOOK_URL) {
          log('Chưa cấu hình DISCORD_WEBHOOK_URL -> bỏ qua gửi Discord.');
          resolve(false);
          return;
        }
        try {
          const urlObj = new URL(DISCORD_WEBHOOK_URL);
          const data = JSON.stringify(payload);
          const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            }
          }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(true);
              } else {
                log(`Gửi Discord thất bại (HTTP ${res.statusCode}): ${body}`);
                resolve(false);
              }
            });
          });
          req.on('error', err => {
            log(`Lỗi gửi Discord: ${err.message}`);
            resolve(false);
          });
          req.write(data);
          req.end();
        } catch (e) {
          log(`Lỗi gửi Discord: ${e.message}`);
          resolve(false);
        }
      });
    }

    // Gom xong bảng xếp hạng (dòng tiêu đề "Tiêu diệt BOSS" + các dòng xếp
    // hạng phía dưới) -> ghép "Tay Chính" (tên vật phẩm đang cầm) + "Stage"
    // (số Ải, tách ra từ chính dòng tiêu đề) rồi gửi 1 embed lên Discord.
    async function hoanTatVaGuiBangXepHang() {
      if (!dongTieuDeBangXepHang) return;

      const tenTayChinh = layTenTayChinhHienTai();
      const khopAi = dongTieuDeBangXepHang.match(/Ải\s*(\d+)/i);
      const stage = khopAi ? `Ải ${khopAi[1]}` : '(không rõ)';
      const noiDungBang = [dongTieuDeBangXepHang, ...cacDongXepHang].join('\n');

      log(`Phát hiện "Tiêu diệt BOSS" -> gửi bảng Status lên Discord (acc ${USERNAME}, ${stage}, tay cầm: ${tenTayChinh}).`);

      await guiDiscordWebhook({
        embeds: [
          {
            title: `Status - ${USERNAME}`,
            color: 0x2ecc71,
            fields: [
              { name: 'Tài Khoản', value: USERNAME, inline: true },
              { name: 'Tay Chính', value: tenTayChinh, inline: true },
              { name: 'Stage', value: stage, inline: true }
            ],
            description: '```\n' + noiDungBang + '\n```',
            timestamp: new Date().toISOString()
          }
        ]
      });

      dangThuThapBangXepHang = false;
      dongTieuDeBangXepHang = null;
      cacDongXepHang = [];
      thuThapBangXepHangTimeout = null;
    }

    async function xuLyKhongCoThuong() {
      if (done || dangXuLySuKienDungeon) return;
      dangXuLySuKienDungeon = true;
      log('"Ải này không có thưởng rơi" -> vô lại dungeon, KHÔNG gọi lại Khởi Động.');
      farmActive = false;
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      bot.clearControlStates();
      await sleep(500);
      await voDungeon(); // gọi trực tiếp ở đây vì lúc này KHÔNG gọi khoiDong() ngay sau -> không bị trùng /warp
      batDauFarm();
      setTimeout(() => { dangXuLySuKienDungeon = false; }, 3000);
    }

    async function xuLyCoThuong() {
      if (done || dangXuLySuKienDungeon) return;
      dangXuLySuKienDungeon = true;
      log('"Phần thưởng ải" -> chờ 6s, /is, đi thẳng 3s rồi Khởi Động lại (khoiDong() tự vô lại dungeon).');
      farmActive = false;
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      bot.clearControlStates();

      await sleep(6000);
      if (done) return;

      guiLenh('/is');

      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      await sleep(3000);
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);

      await khoiDong(); // khoiDong() đã tự gọi voDungeon() ở bước đầu, KHÔNG gọi voDungeon() ở đây nữa (tránh gửi /warp 2 lần)
      setTimeout(() => { dangXuLySuKienDungeon = false; }, 3000);
    }

    bot.once('spawn', async () => {
      balInt = setInterval(() => { if (!done) guiLenh('/bal'); }, 180000);
      bot.physics.enabled = false;
      ignoreChat = true;
      setTimeout(() => { ignoreChat = false; }, 10000);

      await sleep(2000);
      if (done) return;
      guiLenh(`/login ${PASSWORD}`);
      
      await sleep(2000);
      if (done) return;
      await joinSky();

      if (done) return;
      await khoiDong();
    });

    // ============================================================
    //  VÁ LỖI TỐC ĐỘ
    // ============================================================
    const KEY_ATTR_TOC_DO = 'minecraft:movement_speed';
    const UUID_MOD_SPEED = '91aeaa56-376b-4498-935b-2f7f68070635';
    const UUID_MOD_SLOWNESS = '7107de5e-7ce8-4030-940e-514c1f160890';
    const UUID_MOD_VAT_PHAM = 'a1b2c3d4-e5f6-4a1b-8c9d-1234567890ab';
    const UUID_MOD_SKILL_MMO = 'b2c3d4e5-f6a7-4b2c-9d0e-234567890abc';
    const BASE_TOC_DO_VANILLA = 0.1;

    function layMovementSpeedTuVatPhamDangCam() {
      try {
        const item = bot.heldItem;
        const lore = item && item.customLore;
        if (!Array.isArray(lore)) return 0;
        for (const dong of lore) {
          // Mỗi dòng lore có thể là chuỗi/JSON (server cũ) HOẶC thẻ NBT thô
          // {type, value} (item component 1.20.5+) -> phẳng hoá trước rồi
          // mới bóc ra chữ, giống hệt cách xử lý tên vật phẩm ở trên.
          const gt = (dong && typeof dong === 'object' && 'type' in dong && 'value' in dong)
            ? nbtTagSangPhang(dong)
            : dong;
          const chu = boGiaTriRaChu(gt) || (typeof gt === 'string' ? gt : chatComponentToText(gt));
          if (!chu) continue;
          const m = chu.match(/Movement Speed:\s*\+?(-?\d+(?:\.\d+)?)/i);
          if (m) return parseFloat(m[1]) / 100;
        }
      } catch (e) {}
      return 0;
    }

    function capNhatAttributeTocDoTheoHieuUng() {
      if (!bot.entity) return;
      const effects = bot.entity.effects || {};
      const capSpeed = effects[0] ? effects[0].amplifier + 1 : 0;
      const capSlowness = effects[1] ? effects[1].amplifier + 1 : 0;
      const boSuaTuVatPham = layMovementSpeedTuVatPhamDangCam();

      const attrHienTai = bot.entity.attributes && bot.entity.attributes[KEY_ATTR_TOC_DO];
      const baseGoc = attrHienTai && attrHienTai.value > 0 ? attrHienTai.value : BASE_TOC_DO_VANILLA;

      const modifiersKhac = ((attrHienTai && attrHienTai.modifiers) || []).filter(
        m => m.uuid !== UUID_MOD_SPEED && m.uuid !== UUID_MOD_SLOWNESS &&
             m.uuid !== UUID_MOD_VAT_PHAM && m.uuid !== UUID_MOD_SKILL_MMO
      );

      const modifiersMoi = [...modifiersKhac];
      if (capSpeed > 0) {
        modifiersMoi.push({ uuid: UUID_MOD_SPEED, amount: 0.2 * capSpeed, operation: 2 });
      }
      if (capSlowness > 0) {
        modifiersMoi.push({ uuid: UUID_MOD_SLOWNESS, amount: Math.max(-1, -0.15 * capSlowness), operation: 2 });
      }
      if (boSuaTuVatPham !== 0) {
        modifiersMoi.push({ uuid: UUID_MOD_VAT_PHAM, amount: boSuaTuVatPham, operation: 2 });
      }
      if (TD !== 0) {
        modifiersMoi.push({ uuid: UUID_MOD_SKILL_MMO, amount: TD, operation: 2 });
      }

      if (!bot.entity.attributes) bot.entity.attributes = {};
      bot.entity.attributes[KEY_ATTR_TOC_DO] = { value: baseGoc, modifiers: modifiersMoi };
    }

    vaTocDoInt = setInterval(() => { if (!done) capNhatAttributeTocDoTheoHieuUng(); }, 1000);

    // Mỗi khi tay chính đổi (dù do đâu): ép lại về slot kiếm rồi mới tính
    // lại attribute tốc độ theo đúng vật phẩm đang cầm thật sự (slot kiếm).
    bot.on('heldItemChanged', () => {
      if (done) return;
      epVeSlotKiem('heldItemChanged');
      capNhatAttributeTocDoTheoHieuUng();
    });

    bot.on('bossBarCreated', xuLyBossBarThayDoi);
    bot.on('bossBarUpdated', xuLyBossBarThayDoi);
    bot.on('bossBarDeleted', () => { dangBaoVeTraiTim = false; });

    bot.on('death', () => {
      if (done) return;
      log('Bot đã chết -> chờ hồi sinh.');
      dangSong = false; // tạm dừng /tpa, /taf định kỳ trong lúc chờ hồi sinh
      farmActive = false;
      try { bot.pathfinder.setGoal(null); } catch (e) {}
      bot.clearControlStates();
    });
    bot.on('respawn', async () => {
      if (done) return;
      dangSong = true;
      log('Đã hồi sinh -> Khởi Động lại (khoiDong() tự vô lại dungeon).');
      try { bot.setQuickBarSlot(SLOT_KIEM); } catch (e) {}
      await sleep(1000);
      if (!done) await khoiDong();
    });

    bot.on('entityEffect', (entity, effect) => {
      if (done || !bot.entity || !entity || entity.id !== bot.entity.id) return;
      capNhatAttributeTocDoTheoHieuUng();
    });
    bot.on('entityEffectEnd', (entity, effect) => {
      if (done || !bot.entity || !entity || entity.id !== bot.entity.id) return;
      capNhatAttributeTocDoTheoHieuUng();
    });

    bot.on('windowOpen', w => {
      if (done || guiBusy || phase === 'skyMenu' || phase === 'skyUpdated') return;
      bot.closeWindow(w);
    });

    bot.on('message', async msg => {
      if (done) return;
      const clean = msg.toString().replace(/§[0-9a-fklmnor]/gi, '').trim();
      if (!clean) return;

      if (clean.includes('Câu lệnh không tồn tại')) {
        recon('Lobby');
        return;
      }
      
      if (clean.includes('❤')) return;

      if (clean.includes('Hãy hoàn thành thức tỉnh để tham gia cuộc chinh phạt')) {
        coThongBaoThucTinh = true;
      }
      if (clean.includes('Ải này không có thưởng rơi')) {
        xuLyKhongCoThuong();
      }
      if (clean.includes('Phần thưởng ải')) {
        xuLyCoThuong();
      }
      if (clean.includes('TriggerBot đã tắt.')) {
        xuLyBatTaf();
      }

      // Phát hiện dòng "Tiêu diệt BOSS" -> bắt đầu 1 phiên gom bảng xếp hạng
      // mới. Các dòng xếp hạng "1. Tên - ... st (...%) ..." in ra ngay sau
      // đó sẽ được gom vào, chờ THOI_GIAN_CHO_DONG_XEP_HANG_MS không thấy
      // dòng mới nào nữa thì gửi hết lên Discord.
      if (REGEX_TIEU_DIET_BOSS.test(clean)) {
        dangThuThapBangXepHang = true;
        dongTieuDeBangXepHang = clean;
        cacDongXepHang = [];
        if (thuThapBangXepHangTimeout) clearTimeout(thuThapBangXepHangTimeout);
        thuThapBangXepHangTimeout = setTimeout(() => { hoanTatVaGuiBangXepHang(); }, THOI_GIAN_CHO_DONG_XEP_HANG_MS);
      } else if (dangThuThapBangXepHang && REGEX_DONG_XEP_HANG.test(clean)) {
        cacDongXepHang.push(clean);
        if (thuThapBangXepHangTimeout) clearTimeout(thuThapBangXepHangTimeout);
        thuThapBangXepHangTimeout = setTimeout(() => { hoanTatVaGuiBangXepHang(); }, THOI_GIAN_CHO_DONG_XEP_HANG_MS);
      }

      if (ignoreChat) return;
      console.log(`${C.white}[${USERNAME}] ${clean}${C.reset}`); // chat server -> màu trắng
    });

    bot.on('resourcePack', (u, h) => {
      bot._client.write('resource_pack_receive', { uuid: h, result: 0 });
      setTimeout(() => { if (!done) bot._client.write('resource_pack_receive', { uuid: h, result: 3 }); }, 3000);
    });
    bot._client.on('resource_pack_push', d => {
      bot._client.write('resource_pack_receive', { uuid: d.uuid, result: 0 });
      setTimeout(() => { if (!done) bot._client.write('resource_pack_receive', { uuid: d.uuid, result: 3 }); }, 3000);
    });

    bot.on('end', rsn => { if (!done) recon(rsn); });
    bot.on('error', err => {
      if (err.code !== 'EPIPE' && err.name !== 'PartialReadError') log(`Lỗi: ${err.message}`);
    });

  }, delay);
}

startBot();
