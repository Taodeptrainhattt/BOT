const mineflayer = require('mineflayer');
const readline   = require('readline');
const { pathfinder } = require('mineflayer-pathfinder');

// CONFIG
const HOST     = 'mc.minerua.com';
const PORT     = 25565;
const VERSION  = '1.21.4';
const USERNAME = 'NT_Gamingvn'; 
const PASSWORD = 'nguyentrungtinh0102';

const CHAT_GAP = 6500;
const WARP_CMD = '/warp dungeon2';

const TPA_INT = 60000;
const TPA_TMO = 30000;

const C = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };

process.on('uncaughtException', err => { if (err.code !== 'EPIPE' && err.name !== 'PartialReadError') console.error('Lỗi:', err.message); });
process.on('unhandledRejection', r => {});

const sleep = ms => new Promise(res => setTimeout(res, ms));
const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

let activeBot = null;
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', l => { if (l.trim() && activeBot) activeBot.chat(l.trim()); });

const HOSTILE_MOBS = new Set(['zombie', 'skeleton', 'spider', 'cave_spider', 'creeper', 'enderman', 'witch', 'blaze', 'ghast', 'magma_cube', 'slime', 'silverfish', 'endermite', 'guardian', 'elder_guardian', 'drowned', 'husk', 'stray', 'wither_skeleton', 'zombified_piglin', 'piglin_brute', 'hoglin', 'zoglin', 'ravager', 'pillager', 'vindicator', 'evoker', 'vex', 'warden', 'breeze']);

function startBot(delay = 0) {
  setTimeout(() => {
    console.log(`[${USERNAME}] Start Lite...`);

    const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USERNAME, version: VERSION, auth: 'offline', checkTimeoutInterval: 60000, keepAlive: true, hideErrors: true });
    bot.loadPlugin(pathfinder);
    activeBot = bot;
    bot.setMaxListeners(50);

    let done = false, guiBusy = false, phase = 'init', ignoreChat = false, lastChat = 0;
    let trigAct = true, lookTmr = null, balInt = null, farmRun = false;
    let tpaInt = null, tpaTmo = null, waitTpa = false;

    const log = msg => console.log(`[${USERNAME}] ${msg}`);

    async function chatCmd(cmd) {
      const el = Date.now() - lastChat;
      if (el < CHAT_GAP) await sleep(CHAT_GAP - el);
      lastChat = Date.now();
      bot.chat(cmd);
    }

    function startLook() {
      if (lookTmr) return;
      lookTmr = setInterval(() => {
        if (!trigAct || done) return;
        const target = bot.nearestEntity(e => e?.name && e.type !== 'player' && HOSTILE_MOBS.has(e.name.toLowerCase()) && bot.entity.position.distanceTo(e.position) <= 10);
        if (target) try { bot.lookAt(target.position.offset(0, target.height/2, 0)); } catch(_) {}
      }, 200);
    }

    function stopLook() {
      if (!lookTmr) return;
      clearInterval(lookTmr);
      lookTmr = null;
    }

    async function setFarm(wantOn) {
      if ((!trigAct) === wantOn) return;
      await chatCmd('/taf autofarm');
      await sleep(1500); 
    }

    function stopTpa() {
      if (tpaInt) { clearInterval(tpaInt); tpaInt = null; }
      if (tpaTmo) { clearTimeout(tpaTmo); tpaTmo = null; }
      waitTpa = false;
    }

    function startTpa() {
      stopTpa();
      tpaInt = setInterval(async () => {
        if (done || waitTpa) return;
        waitTpa = true;
        log(`${C.cyan}[TPA] Check${C.reset}`);
        await chatCmd('/tpa');

        tpaTmo = setTimeout(async () => {
          if (!waitTpa) return;
          waitTpa = false;
          log(`${C.red}[TPA] Bị kick -> Reset${C.reset}`);
          stopTpa();
          stopLook();
          farmRun = false;
          await doFarmSeq();
        }, TPA_TMO);
      }, TPA_INT);
    }

    async function walkStep() {
      bot.physics.enabled = true;
      bot.setControlState('forward', true);
      await sleep(1200);
      bot.setControlState('forward', false);
      bot.physics.enabled = false;
      await sleep(500);
    }

    function recon(rsn) {
      if (done) return;
      done = true;
      if (balInt) clearInterval(balInt);
      stopTpa();
      stopLook();
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
        bot.chat('/sky');
        const h = async w => {
          if (phase !== 'skyMenu' || guiBusy) return;
          guiBusy = true;
          try {
            await sleep(rand(1000, 1400));
            await bot.clickWindow(14, 0, 0);
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

    async function actDungeon() {
      log(`${C.yellow}[DG] Khởi động${C.reset}`);
      await setFarm(false);
      if (done) return;

      bot.physics.enabled = true;
      bot.setControlState('forward', true);
      await sleep(5000);
      bot.setControlState('forward', false);
      bot.physics.enabled = false;

      await setFarm(true);
    }

    async function fullReset() {
      if (farmRun) return;
      farmRun = true;
      try {
        log(`${C.cyan}[RESET] Bắt đầu${C.reset}`);
        await setFarm(false);
        if (done) return;
        await chatCmd('/is');
        await sleep(3000);
        if (done) return;
        await walkStep();
        if (done) return;
        await chatCmd(WARP_CMD);
        await sleep(6000);
        await walkStep();
        if (done) return;
        await actDungeon();
        startTpa();
        log(`${C.green}[RESET] Xong${C.reset}`);
      } finally { farmRun = false; }
    }

    async function doFarmSeq() {
      if (farmRun) return;
      farmRun = true;
      try {
        log(`${C.cyan}${WARP_CMD}${C.reset}`);
        await chatCmd(WARP_CMD);
        await sleep(6000);
        if (done) return;
        await actDungeon();
        startTpa();
      } finally { farmRun = false; }
    }

    bot.once('spawn', async () => {
      balInt = setInterval(() => { if (!done) bot.chat('/bal'); }, 180000);
      bot.physics.enabled = false;
      ignoreChat = true;
      setTimeout(() => { ignoreChat = false; }, 10000);

      await sleep(2000);
      if (done) return;
      bot.chat(`/login ${PASSWORD}`);
      
      await sleep(2000);
      if (done) return;
      await joinSky();
      
      if (done) return;
      await setFarm(true);
      await sleep(3000);
      if (done) return;
      await doFarmSeq();
    });

    bot.on('windowOpen', w => {
      if (done || guiBusy || phase === 'skyMenu' || phase === 'skyUpdated') return;
      bot.closeWindow(w);
    });

    bot.on('message', async msg => {
      if (done) return;
      const clean = msg.toString().replace(/§[0-9a-fklmnor]/gi, '').trim();
      if (!clean) return;
      
      if (clean.includes('can\'t use /tpa here')) {
        if (waitTpa) {
          waitTpa = false;
          if (tpaTmo) { clearTimeout(tpaTmo); tpaTmo = null; }
          log(`${C.green}[TPA] OK${C.reset}`);
        }
        return;
      }

      if (clean.includes('AutoFarm BẬT!')) {
        log(`${C.green}[AF] Bật${C.reset}`);
        trigAct = false;
        stopLook();
        return;
      }
      if (clean.includes('AutoFarm TẮT')) {
        log(`${C.yellow}[AF] Tắt${C.reset}`);
        trigAct = true;
        startLook();
        return;
      }
      if (clean.includes('Tiêu diệt BOSS | Hoàn thành!')) {
        stopTpa();
        stopLook();
        farmRun = true; 
        log(`${C.green}[BOSS] Chờ 20s${C.reset}`);
        await sleep(20000);
        if (done) return;
        farmRun = false;
        await fullReset();
        return;
      }
      if (clean.includes('Câu lệnh không tồn tại')) {
        recon('Lobby');
        return;
      }
      
      // Ẩn log hiển thị máu (ActionBar)
      if (clean.includes('❤')) return;

      if (ignoreChat) return;
      log(clean);
    });

    bot.on('death', async () => {
      log(`${C.red}[DEATH] Chờ respawn${C.reset}`);
      stopTpa();
      farmRun = true;
      await sleep(3000);
      if (done) return;
      farmRun = false;
      await doFarmSeq();
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
