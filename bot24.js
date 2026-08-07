const mineflayer = require("mineflayer");
const readline = require("readline");

// Chặn toàn bộ lỗi không bắt được (như PartialReadError từ protodef) để bot không bị sập
process.on("uncaughtException", (err) => {
  console.log(`[UNCAUGHT] ${err.message}`);
});
process.on("unhandledRejection", (err) => {
  console.log(`[UNHANDLED] ${err && err.message ? err.message : err}`);
});

const HOST = "mc.minerua.com";
const PORT = 25565;
const VERSION = "1.21.1";
const TEN = "NT_Gamingvn";
const MAT_KHAU = "nguyentrungtinh0102";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

// ===== CẤU HÌNH AUTO ATTACK (CHỈ ĐÁNH QUÁI, BỎ QUA NGƯỜI CHƠI) =====
const AUTO_ATTACK = {
  enabled: true,
  range: 4.0, // khoảng cách tối đa để tấn công (block)
  attackCooldownMs: 300, // thời gian giữa các lần đánh (cố định)
  checkIntervalMs: 100, // tần suất quét mục tiêu
  swing: true, // có vung tay khi đánh không
};

// ===== CẤU HÌNH CẤT ĐỒ VÀO KHO =====
const KHO_SO = [1, 2, 3, 4];
const KHO_DO_TRONG = 30;
const THOI_GIAN_KIEM_KHO = 15000;

// ===== CẤU HÌNH /FARM ĐỊNH KỲ =====
const THOI_GIAN_FARM = 10 * 60 * 1000; // 10 phút

// ===== CẤU HÌNH LỌC VẬT PHẨM =====
// Vật phẩm TUYỆT ĐỐI không được đụng tới (không cất kho, không trash) dù bất kỳ chu kỳ nào.
const ID_VAT_PHAM_BAT_KHA_XAM_PHAM = ["nether_sword", "netherite_sword"];

// Danh sách TRẮNG: /trash CHỈ được vứt các vật phẩm nằm trong danh sách này.
// Mọi thứ khác (ngoài xương và kiếm netherite) sẽ được giữ nguyên trong túi.
const ID_VAT_PHAM_DUOC_TRASH = [
  "feather", // lông gà
  "chicken", // thịt gà (sống)
  "cooked_chicken", // thịt gà chín
  "rotten_flesh", // thịt thối
  "gold_ingot", // vàng
  "golden_sword", // kiếm vàng
  "gold_nugget", // hạt vàng
  "ender_pearl", // ngọc ender
  "golden_axe", // rìu vàng
];

// Danh sách vật phẩm được CẤT VÀO KHO (ngoài xương)
const ID_VAT_PHAM_CAT_KHO = [
  "bone", // xương
  "tube_coral", // san hô ống
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

let botDangChay = null;

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const msg = line.trim();
  if (!msg) return;
  if (botDangChay) {
    botDangChay.chat(msg);
    console.log(`Chat: ${msg}`);
  } else {
    console.log("Chưa online >:(");
  }
});

// ===== Các hàm nhận diện vật phẩm =====

// Bỏ tiền tố "minecraft:" (nếu có) và chuyển về chữ thường để so sánh id cho chắc
function chuanHoaId(name) {
  return (name || "")
    .toString()
    .replace(/^minecraft:/i, "")
    .toLowerCase();
}

// Kiếm netherite: TUYỆT ĐỐI không đụng (không cất kho, không trash)
function laVatPhamKhongDuocDung(item) {
  if (!item) return false;
  const id = chuanHoaId(item.name);
  return ID_VAT_PHAM_BAT_KHA_XAM_PHAM.some((x) => id === chuanHoaId(x));
}

// Xương / San hô ống: các món này được cất vào kho
function laVatPhamXuong(item) {
  if (!item) return false;
  const id = chuanHoaId(item.name);
  return ID_VAT_PHAM_CAT_KHO.some((x) => id === chuanHoaId(x));
}

// Danh sách trắng cho /trash: CHỈ những vật phẩm này mới được vứt
function laVatPhamDuocTrash(item) {
  if (!item) return false;
  const id = chuanHoaId(item.name);
  return ID_VAT_PHAM_DUOC_TRASH.some((x) => id === chuanHoaId(x));
}

function khoitaobot(delay = 0) {
  setTimeout(() => {
    console.log(`Khởi tạo...`);

    const bot = mineflayer.createBot({
      host: HOST,
      port: PORT,
      username: TEN,
      version: VERSION,
      auth: "offline",
      checkTimeoutInterval: 60000,
      keepAlive: true,
      hideErrors: true,
      skipValidation: true,
    });

    botDangChay = bot;

    // Chặn lỗi parse packet (PartialReadError, v.v...) không cho crash bot
    bot._client.on("error", (err) => {
      console.log(`${C.red}[Protocol Error] ${err.message}${C.reset}`);
    });

    let done = false;
    let ignoreChat = true;
    let guiBusy = false;
    let phase = "init";
    let lastAttackTime = 0;
    let attackTimer = null;
    let storageBusy = false;
    let khoTimer = null;
    let farmBusy = false;
    let dangVeSpawn = false; // true khi đang trong quá trình /claim tp → /clan spawn, cần đứng yên tuyệt đối

    // Timer /farm định kỳ
    let farmTimer = null;

    bot.setMaxListeners(50);

    const log = (msg) => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      console.log(
        `${C.blue}[${time}]${C.reset} ${C.red}[${TEN}]${C.reset} ${msg}`,
      );
    };

    function dungAttackTimer() {
      if (attackTimer) {
        clearInterval(attackTimer);
        attackTimer = null;
      }
    }

    const dungKhoTimer = () => {
      if (khoTimer) {
        clearInterval(khoTimer);
        khoTimer = null;
      }
    };

    // ===== Lấy giờ hiện tại dạng HH:mm:ss (giống format log) =====
    function layGioHienTai() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    function dungFarmTimer() {
      if (farmTimer) {
        clearInterval(farmTimer);
        farmTimer = null;
      }
    }

    // ===== Về spawn: đứng yên tuyệt đối → /claim tp 1775 → chờ 6s → /clan spawn =====
    async function veSpawn(soLanThu = 1) {
      if (done) return;
      dangVeSpawn = true; // chặn auto attack (lookAt/attack/swing) để không bị coi là "di chuyển"

      try {
        // Đứng yên tuyệt đối: bỏ hết control state đang giữ, tắt vật lý, dừng mọi vận tốc còn sót
        bot.clearControlStates();
        bot.physics.enabled = false;
        if (bot.entity && bot.entity.velocity) {
          bot.entity.velocity.x = 0;
          bot.entity.velocity.y = 0;
          bot.entity.velocity.z = 0;
        }
        await sleep(300); // chờ một nhịp cho chắc là đã đứng yên hẳn

        if (done) return;
        bot.chat(`/claim tp 1775`);
        log(`${C.yellow}Đã /claim tp 1775, đứng yên chờ 6s...${C.reset}`);
        await sleep(10000);
        if (done) return;

        bot.chat(`/clan spawn`);
        log(`${C.yellow}Đã /clan spawn${C.reset}`);

        // Chờ thêm chút để chắc chắn lệnh /clan spawn xử lý xong trước khi thả auto attack ra
        await sleep(3000);
      } catch (e) {
        log(`${C.red}[SPAWN] Lỗi: ${e.message}${C.reset}`);
      } finally {
        dangVeSpawn = false;
      }
    }

    // Nếu server báo "Bạn đã di chuyển, quá trình dịch chuyển bị hủy!" → thử lại veSpawn
    let dangRetrySpawn = false;
    async function thuLaiVeSpawnNeuBiHuy() {
      if (done || dangRetrySpawn) return;
      dangRetrySpawn = true;
      log(`${C.red}[SPAWN] Bị hủy do di chuyển → thử lại /claim tp + /clan spawn${C.reset}`);
      await sleep(rand(500, 1000));
      if (!done) await veSpawn();
      dangRetrySpawn = false;
    }

    // ===== Bắt đầu chu kỳ 10 phút: /farm → chờ 3s → veSpawn (/claim tp 1775 → chờ 6s → /clan spawn) =====
    // (có chờ nếu đang cất đồ vào kho để tránh xung đột GUI)
    function batDauFarmDinhKy() {
      dungFarmTimer();
      farmTimer = setInterval(async () => {
        if (done) return;

        // Nếu đang cất bone/tube_coral vào kho hoặc đang /trash → chờ tối đa 10s
        if (storageBusy) {
          log(`${C.yellow}[FARM] Đang bận cất kho, chờ...${C.reset}`);
          let cho = 0;
          while (storageBusy && cho < 10000) {
            await sleep(300);
            cho += 300;
          }
          if (done || storageBusy) {
            log(`${C.yellow}[FARM] Vẫn đang bận kho, bỏ qua lượt này${C.reset}`);
            return;
          }
        }

        farmBusy = true;
        const gio = layGioHienTai();
        log(`${C.yellow}[FARM] [${gio}] Đến giờ → /farm${C.reset}`);
        try {
          bot.chat(`/farm`);
          await sleep(3000);
          if (done) {
            farmBusy = false;
            return;
          }
          await veSpawn();
        } catch (e) {
          log(`${C.red}[FARM] Lỗi: ${e.message}${C.reset}`);
        }
        farmBusy = false;
      }, THOI_GIAN_FARM);
    }

    function demOTrong() {
      let count = 0;
      for (let i = 9; i <= 44; i++) {
        if (!bot.inventory.slots[i]) count++;
      }
      return count;
    }

    function demSlot() {
      let filled = 0;
      for (let i = 9; i <= 44; i++) {
        if (i === 36) continue;
        if (bot.inventory.slots[i]) filled++;
      }
      return filled;
    }

    // Đếm số slot còn "rác trong danh sách trắng" (không tính xương, không tính kiếm netherite)
    function demSlotRac() {
      let filled = 0;
      for (let i = 9; i <= 44; i++) {
        if (i === 36) continue;
        const item = bot.inventory.slots[i];
        if (!item) continue;
        if (laVatPhamKhongDuocDung(item)) continue;
        if (laVatPhamXuong(item)) continue;
        if (!laVatPhamDuocTrash(item)) continue;
        filled++;
      }
      return filled;
    }

    // ===== Cất đồ vào kho: CHỈ cất Xương / bone, tuyệt đối bỏ qua kiếm netherite =====
    async function catDo() {
      if (done || storageBusy) return;
      storageBusy = true;
      log(`${C.yellow}[KHO] Đang cất đồ (xương + san hô ống)...${C.reset}`);

      for (const so of KHO_SO) {
        if (done) break;

        // Nếu không còn xương nào trong túi thì khỏi mở kho làm gì
        const conXuong = (() => {
          for (let i = 9; i <= 44; i++) {
            if (i === 36) continue;
            const item = bot.inventory.slots[i];
            if (item && laVatPhamXuong(item)) return true;
          }
          return false;
        })();
        if (!conXuong) {
          log(`${C.green}[KHO] Không còn xương/san hô trong túi${C.reset}`);
          break;
        }

        log(`${C.cyan}[KHO] Mở kho ${so}${C.reset}`);
        bot.chat(`/clan openstorage ${so}`);

        const gui = await new Promise((resolve) => {
          const onWin = (w) => resolve(w);
          bot.once("windowOpen", onWin);
          setTimeout(() => {
            bot.removeListener("windowOpen", onWin);
            resolve(null);
          }, 8000);
        });

        if (!gui || done) {
          log(`[KHO] Không mở được kho ${so}, bỏ qua`);
          continue;
        }

        await sleep(500);
        const batDauTui = gui.inventoryStart ?? gui.slots.length - 36;
        const slotKho = gui.slots.slice(0, batDauTui);
        const dayCo = slotKho.filter((s) => s).length;
        const tongKho = batDauTui;
        log(`${C.cyan}[KHO ${so}] ${dayCo}/${tongKho} slot${C.reset}`);

        for (let i = batDauTui + 1; i < batDauTui + 36; i++) {
          if (done) break;
          const item = gui.slots[i];
          if (!item) continue;

          // Tuyệt đối không đụng tới vật phẩm được bảo vệ
          if (laVatPhamKhongDuocDung(item)) continue;

          // Chỉ cất xương/san hô ống, thứ khác để dành cho /trash
          if (!laVatPhamXuong(item)) continue;

          try {
            await bot.clickWindow(i, 0, 1);
            await sleep(rand(150, 300));
          } catch (e) {}
        }

        await sleep(300);
        if (!done && bot.currentWindow) bot.closeWindow(bot.currentWindow);
        await sleep(500);

        log(`[KHO] Đã xử lý xong kho ${so}`);
      }

      log(`${C.yellow}[KHO] Hoàn tất cất đồ${C.reset}`);
      storageBusy = false;
    }

    // ===== Bỏ rác vào /trash: CHỈ vứt các vật phẩm trong danh sách trắng =====
    async function catRac() {
      if (done || storageBusy) return;
      storageBusy = true;
      log(`${C.yellow}[RÁC] Đang bỏ rác vào /trash...${C.reset}`);

      log(`${C.cyan}[RÁC] Mở /trash${C.reset}`);
      bot.chat(`/trash`);

      const gui = await new Promise((resolve) => {
        const onWin = (w) => resolve(w);
        bot.once("windowOpen", onWin);
        setTimeout(() => {
          bot.removeListener("windowOpen", onWin);
          resolve(null);
        }, 8000);
      });

      if (!gui || done) {
        log(`[RÁC] Không mở được /trash, bỏ qua`);
        storageBusy = false;
        return;
      }

      await sleep(500);
      const batDauTui = gui.inventoryStart ?? gui.slots.length - 36;

      for (let i = batDauTui + 1; i < batDauTui + 36; i++) {
        if (done) break;
        const item = gui.slots[i];
        if (!item) continue;

        // Tuyệt đối không đụng tới kiếm netherite
        if (laVatPhamKhongDuocDung(item)) continue;

        // Không trash xương/san hô, để dành cất kho
        if (laVatPhamXuong(item)) continue;

        // Chỉ vứt nếu vật phẩm nằm trong danh sách trắng
        if (!laVatPhamDuocTrash(item)) continue;

        try {
          await bot.clickWindow(i, 0, 1);
          await sleep(rand(150, 300));
        } catch (e) {}
      }

      await sleep(300);
      if (!done && bot.currentWindow) bot.closeWindow(bot.currentWindow);
      await sleep(500);

      log(`${C.yellow}[RÁC] Hoàn tất bỏ rác${C.reset}`);
      storageBusy = false;
    }

    function batKhoTimer() {
      dungKhoTimer();
      khoTimer = setInterval(async () => {
        if (done || storageBusy || farmBusy) return;
        const trong = demOTrong();
        if (trong <= KHO_DO_TRONG) {
          log(`${C.yellow}[KHO] Còn ${trong} ô trống → xử lý đồ${C.reset}`);
          await catDo(); // cất xương vào kho trước
          if (done) return;
          await sleep(500);
          await catRac(); // sau đó bỏ hết rác còn lại (chỉ vứt các vật phẩm trong danh sách trắng)
        }
      }, THOI_GIAN_KIEM_KHO);
    }

    function reconnect(lyDo) {
      if (done) return;
      done = true;
      botDangChay = null;
      dungAttackTimer();
      dungKhoTimer();
      dungFarmTimer();
      log(`Reconnect: ${lyDo}`);
      bot.removeAllListeners();
      if (bot._client) bot._client.removeAllListeners();
      try {
        bot.end();
      } catch (e) {}
      khoitaobot(2000);
    }

    // ===== Chọn mục tiêu: chỉ MOB, loại bỏ player =====
    function chonMucTieu() {
      const range = AUTO_ATTACK.range;
      let target = null;
      let bestDist = Infinity;

      for (const id in bot.entities) {
        const e = bot.entities[id];
        if (!e || e === bot.entity) continue;

        // Bỏ qua người chơi (filter player)
        if (e.type === "player") continue;

        // Chỉ nhắm sinh vật sống (mob)
        if (e.type !== "mob" && e.type !== "hostile") continue;

        // Bỏ qua entity đã chết / không có health hợp lệ
        if (e.health !== undefined && e.health <= 0) continue;

        const dist = bot.entity.position.distanceTo(e.position);
        if (dist > range) continue;

        if (dist < bestDist) {
          bestDist = dist;
          target = e;
        }
      }

      return target;
    }

    function batDauAutoAttack() {
      if (!AUTO_ATTACK.enabled) return;
      log(
        `${C.green}Bắt đầu auto attack (chỉ đánh quái, bỏ qua player)${C.reset}`,
      );

      attackTimer = setInterval(() => {
        if (done || dangVeSpawn) return;

        const now = Date.now();
        if (now - lastAttackTime < AUTO_ATTACK.attackCooldownMs) return;

        const target = chonMucTieu();
        if (!target) return;

        try {
          bot.lookAt(
            target.position.offset(0, target.height ? target.height / 2 : 1, 0),
            true,
          );
          bot.attack(target);
          if (AUTO_ATTACK.swing) bot.swingArm("right");
          lastAttackTime = now;
        } catch (e) {
          log(`${C.red}[ATTACK] Lỗi: ${e.message}${C.reset}`);
        }
      }, AUTO_ATTACK.checkIntervalMs);
    }

    bot.once("spawn", async () => {
      bot.physics.enabled = false;
      log("Online");
      ignoreChat = true;
      setTimeout(() => {
        ignoreChat = false;
      }, 30000);

      await sleep(2000);
      if (done) return;
      bot.chat(`/login ${MAT_KHAU}`);
      log("/login");
      await sleep(500);
      if (done) return;

      bot.setQuickBarSlot(4);
      await sleep(rand(400, 500));
      if (done) return;
      log("Dùng la bàn");
      phase = "gui1";
      bot.activateItem();
    });

    bot.on("windowOpen", async (gui) => {
      if (done || guiBusy) return;
      if (storageBusy) return;
      guiBusy = true;

      if (phase === "gui1") {
        await sleep(rand(800, 1400));
        if (done) {
          guiBusy = false;
          return;
        }
        log("GUI 1: click slot 25");
        await bot.clickWindow(25, 0, 0);
        if (done) {
          guiBusy = false;
          return;
        }
        phase = "gui2";
        guiBusy = false;
        return;
      }

      if (phase === "gui2") {
        await sleep(rand(800, 1400));
        if (done) {
          guiBusy = false;
          return;
        }
        log("GUI 2: click slot 12");
        await bot.clickWindow(12, 0, 0);
        if (done) {
          guiBusy = false;
          return;
        }
        phase = "gui3";
        guiBusy = false;
        return;
      }

      if (phase === "gui3") {
        await sleep(rand(800, 1400));
        if (done) {
          guiBusy = false;
          return;
        }
        log("GUI 3: click slot 19");
        await bot.clickWindow(19, 0, 0);
        if (done) {
          guiBusy = false;
          return;
        }
        await sleep(rand(400, 700));
        if (done) {
          guiBusy = false;
          return;
        }
        bot.closeWindow(gui);
        phase = "joined";
        guiBusy = false;

        // Vào server xong → chờ 5 giây → bắt đầu AFK + auto attack quái + /farm định kỳ
        await sleep(5000);
        if (done) return;
        log(`${C.yellow}Đã vào server, chuyển sang chế độ AFK${C.reset}`);
        await veSpawn();
        batDauAutoAttack();
        batKhoTimer();
        batDauFarmDinhKy();
        return;
      }

      bot.closeWindow(gui);
      guiBusy = false;
    });

    bot.on("message", (jsonMsg) => {
      if (done) return;
      const raw = jsonMsg.toString();
      log(raw);

      if (ignoreChat) return;

      const clean = raw.replace(/§[0-9a-fklmnor]/gi, "").trim();
      if (clean.includes("MINERUA NETWORK")) {
        reconnect("Bị kick ra lobby");
        return;
      }
      if (clean.includes("Câu lệnh không tồn tại")) {
        reconnect("Đang ở lobby");
        return;
      }
      if (
        clean.includes("quá trình dịch chuyển bị hủy") ||
        clean.includes("Bạn đã di chuyển")
      ) {
        thuLaiVeSpawnNeuBiHuy();
        return;
      }
    });

    bot._client.on("resource_pack_push", (data) => {
      bot._client.write("resource_pack_receive", {
        uuid: data.uuid,
        result: 0,
      });
      setTimeout(() => {
        if (done) return;
        bot._client.write("resource_pack_receive", {
          uuid: data.uuid,
          result: 3,
        });
      }, 3000);
    });

    bot.on("death", async () => {
      if (done) return;
      log(
        `${C.yellow}Bị chết (bất kỳ lý do gì), dùng /claim tp 1775 rồi /clan spawn để quay lại${C.reset}`,
      );
      await sleep(rand(500, 1000));
      if (done) return;
      await veSpawn();

      // Sau khi về spawn, tính lại chu kỳ /farm 5 phút từ đầu
      await sleep(1500);
      if (done) return;
      batDauFarmDinhKy();
    });

    bot.on("end", (reason) => {
      if (!done) reconnect(reason);
    });
    bot.on("error", (err) => {
      if (err.code !== "EPIPE") log(`Lỗi: ${err.message}`);
    });
  }, delay);
}

khoitaobot();