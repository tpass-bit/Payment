/* Firebase */
const firebaseConfig = {
  apiKey: "AIzaSyBPF1VE82Y3VkZe6IibjqKxBC-XHjM_Wco",
  authDomain: "chat-2024-ff149.firebaseapp.com",
  databaseURL: "https://chat-2024-ff149-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chat-2024-ff149",
  storageBucket: "chat-2024-ff149.appspot.com",
  messagingSenderId: "146349109253",
  appId: "1:146349109253:web:e593afbf05847625"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* Constants */
const SYMBOL = "SUZ";
let wallet = null; // object {addr,pinHash}
let balanceListener = null;
let currentHistoryTab = 'all';

/* DOM Helpers */
const qs = id => document.getElementById(id);
const log = (msg, color = "gray") => {
  const t = new Date().toLocaleTimeString();
  qs("log").innerHTML += `<span style='color:${color}'>${t} › ${msg}</span>\n`;
  qs("log").scrollTop = qs("log").scrollHeight;
  if (wallet) db.ref("logs/" + wallet.addr).push({ msg, color, time: Date.now() });
};
const copy = id => navigator.clipboard.writeText(qs(id).innerText).then(() => log("Copied"));

/* ---------- Wallet Management ---------- */
function createOrLoadUniqueWallet() {
  if (localStorage.getItem("wallet_json")) return loadWalletFromStorage();
  const addr = "SUZ_" + Math.random().toString(36).slice(2, 10);
  const pin = prompt("Set a 4‑digit PIN");
  if (!/^\d{4}$/.test(pin)) return alert("PIN must be 4 digits");
  const pinHash = CryptoJS.SHA256(pin).toString();
  wallet = { addr, pinHash };
  localStorage.setItem("wallet_json", JSON.stringify(wallet));
  db.ref("wallets/" + addr).set({ balance: 1000, pinHash });
  onWalletReady();
}

function loadWalletFromStorage() {
  const json = localStorage.getItem("wallet_json");
  if (!json) return;
  wallet = JSON.parse(json);
  onWalletReady();
}

function importBackup() {
  try {
    const json = qs("importKey").value.trim();
    if (!json) return alert("Paste backup JSON");
    wallet = JSON.parse(json);
    if (!wallet.addr || !wallet.pinHash) return alert("Invalid backup");
    localStorage.setItem("wallet_json", json);
    db.ref("wallets/" + wallet.addr).once("value", snap => {
      if (!snap.exists()) db.ref("wallets/" + wallet.addr).set({ balance: 0, pinHash: wallet.pinHash });
      onWalletReady();
    });
  } catch (e) { alert("Bad JSON") }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(wallet)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = wallet.addr + "_backup.json";
  a.click();
}

function wipeWallet() {
  if (confirm("Forget wallet on this device?")) {
    localStorage.removeItem("wallet_json");
    if (balanceListener) balanceListener.off();
    location.reload();
  }
}

function onWalletReady() {
  qs("walletNotFound").classList.add("hidden");
  qs("walletLoaded").classList.remove("hidden");
  qs("balanceCard").classList.remove("hidden");
  qs("sendCard").classList.remove("hidden");
  qs("histCard").classList.remove("hidden");
  qs("addr").innerText = wallet.addr;
  QRCode.toCanvas(qs("qr"), wallet.addr);
  setupBalanceListener();
  loadHistory();
  loadLogHistory();
  log("Wallet ready: " + wallet.addr, "green");
}

/* ---------- Balance Management ---------- */
function setupBalanceListener() {
  // Remove previous listener if exists
  if (balanceListener) balanceListener.off();
  
  // Set up realtime balance updates
  balanceListener = db.ref("wallets/" + wallet.addr + "/balance").on("value", snap => {
    qs("bal").innerText = (snap.val() || 0) + " " + SYMBOL;
  });
}

function loadBalance() {
  db.ref("wallets/" + wallet.addr + "/balance").once("value", snap => {
    qs("bal").innerText = (snap.val() || 0) + " " + SYMBOL;
  });
}

/* ---------- Transaction History ---------- */
function showHistoryTab(tab) {
  currentHistoryTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase() === tab);
  });
  loadHistory();
}

function loadHistory() {
  const ul = qs("txList");
  ul.innerHTML = "";
  
  db.ref("transactions/" + wallet.addr).orderByChild("ts").limitToLast(50).once("value", snap => {
    if (!snap.exists()) return qs("noTx").classList.remove("hidden");
    qs("noTx").classList.add("hidden");
    
    let transactions = Object.values(snap.val()).reverse();
    
    // Filter based on current tab
    if (currentHistoryTab !== 'all') {
      transactions = transactions.filter(tx => 
        (currentHistoryTab === 'sent' && tx.type === "sent") || 
        (currentHistoryTab === 'received' && tx.type === "received")
      );
    }
    
    transactions.forEach(tx => {
      const li = document.createElement("li");
      li.className = "tx-item";
      li.innerHTML = tx.type === "sent" ?
        `<div>
          <strong>To:</strong> ${tx.to}<br>
          <small>${formatTime(tx.ts)}</small>
        </div>
        <div class='tx-amount negative'>- ${tx.amt} ${SYMBOL}</div>` :
        `<div>
          <strong>From:</strong> ${tx.from}<br>
          <small>${formatTime(tx.ts)}</small>
        </div>
        <div class='tx-amount'>+ ${tx.amt} ${SYMBOL}</div>`;
      ul.appendChild(li);
    });
  });
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/* ---------- Log Management ---------- */
function loadLogHistory() {
  qs("log").innerHTML = "";
  db.ref("logs/" + wallet.addr).limitToLast(100).once("value", snap => {
    if (!snap.exists()) return;
    snap.forEach(c => {
      const { msg, color, time } = c.val();
      const t = new Date(time).toLocaleTimeString();
      qs("log").innerHTML += `<span style='color:${color}'>${t} › ${msg}</span>\n`;
    });
    qs("log").scrollTop = qs("log").scrollHeight;
  });
}

/* ---------- Send Tokens ---------- */
function sendToken() {
  const to = qs("to").value.trim();
  const amt = parseInt(qs("amt").value);
  if (!to.startsWith("SUZ_")) return log("Enter valid receiver ID!", "red");
  if (to === wallet.addr) return log("Cannot send to self", "red");
  if (!amt || amt <= 0) return log("Enter valid amount", "red");
  const pin = prompt("Enter 4‑digit PIN to confirm");
  if (CryptoJS.SHA256(pin || "").toString() !== wallet.pinHash) return log("Incorrect PIN", "red");

  db.ref("wallets/" + wallet.addr + "/balance").once("value", snap => {
    const bal = snap.val() || 0;
    if (bal < amt) return log("Insufficient balance", "red");
    db.ref("wallets/" + to + "/balance").once("value", snap2 => {
      const balTo = snap2.val() || 0;
      const ts = Date.now();
      const upd = {};
      upd[`wallets/${wallet.addr}/balance`] = bal - amt;
      upd[`wallets/${to}/balance`] = balTo + amt;
      upd[`transactions/${wallet.addr}/${ts}`] = { type: "sent", to, amt, ts };
      upd[`transactions/${to}/${ts}`] = { type: "received", from: wallet.addr, amt, ts };
      
      db.ref().update(upd).then(() => {
        log(`Sent ${amt} ${SYMBOL} to ${to}`, 'green');
        qs("to").value = ""; 
        qs("amt").value = "";
        showPaymentSuccess(`Successfully sent ${amt} ${SYMBOL} to ${to}`);
      });
    });
  });
}

/* ---------- Payment Success Overlay ---------- */
function showPaymentSuccess(message) {
  qs("successMessage").textContent = message;
  qs("paymentSuccess").classList.remove("hidden");
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (!qs("paymentSuccess").classList.contains("hidden")) {
      hidePaymentSuccess();
    }
  }, 5000);
}

function hidePaymentSuccess() {
  qs("paymentSuccess").classList.add("hidden");
}

/* ---------- QR Scanner ---------- */
let html5Qr = null;
function openScanner() {
  qs("scannerModal").style.display = "flex";
  if (!html5Qr) {
    html5Qr = new Html5Qrcode("scanner");
  }
  html5Qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
    code => {
      if (code.startsWith("SUZ_")) {
        qs("to").value = code;
        closeScanner();
      }
    }, err => { });
}
function closeScanner() {
  html5Qr.stop().then(() => qs("scannerModal").style.display = "none");
}

/* ---------- Theme & Init ---------- */
window.addEventListener("load", () => {
  loadWalletFromStorage();
  qs("themeToggle").onclick = () => {
    document.body.classList.toggle("light");
    const i = qs("themeToggle").firstElementChild;
    i.classList.toggle("fa-sun"); 
    i.classList.toggle("fa-moon");
  };
});
