// ==========================================
// 全域變數與伺服器設定
// ==========================================
const API_BASE_URL = "http://127.0.0.1:5000"; // 後端伺服器的網址

let currentUser = {
    email: "",
    name: "",
    balance: 0
};
let currentAuthMode = "login";

let availableStocks = {};

// ==========================================
// 頁籤切換邏輯 (維持不變)
// ==========================================
function switchAuthTab(mode) {
    currentAuthMode = mode;
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const nameField = document.getElementById('name-field');
    const submitBtn = document.getElementById('btn-auth-submit');
    
    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        nameField.classList.add('hidden');
        submitBtn.innerText = "立即登入";
    } else {
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        nameField.classList.remove('hidden');
        submitBtn.innerText = "建立帳號 (贈送 $1,000,000)";
    }
}

function handleAuthSubmit() {
    if (currentAuthMode === "login") login();
    else register();
}

// ==========================================
// 1. 註冊帳號 (串接真實 /api/register)
// ==========================================
async function register() {
    const name = document.getElementById('user-name').value;
    const email = document.getElementById('user-email').value;
    const password = document.getElementById('user-password').value;

    if (!name || !email || !password) {
        alert("請填寫完整註冊資訊！"); return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            alert(result.message); // 會顯示後端產生的 ID00X
            currentUser = { email: email, name: name, balance: result.balance };
            showDashboard();
        } else {
            alert("註冊失敗：" + result.message);
        }
    } catch (error) {
        console.error("連線錯誤:", error);
        alert("無法連線到伺服器，請確認後端已啟動。");
    }
}

// ==========================================
// 2. 使用者登入 (串接真實 /api/login)
// ==========================================
async function login() {
    const email = document.getElementById('user-email').value;
    const password = document.getElementById('user-password').value;

    if (!email || !password) {
        alert("請輸入 Email 與密碼！"); return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            alert("登入成功！");
            currentUser = { email: email, name: result.name, balance: result.balance };
            showDashboard();
        } else {
            alert("登入失敗：" + result.message);
        }
    } catch (error) {
        console.error("連線錯誤:", error);
        alert("無法連線到伺服器。");
    }
}

// ==========================================
// 3. 取得股票清單 (暫時保留前端假資料，等待後端補上 API)
// ==========================================
// ==========================================
// 3. 取得股票清單 (串接真實 /api/stocks)
// ==========================================
async function getStocks() {
    try {
        // 使用 GET 方法呼叫大盤 API
        const response = await fetch(`${API_BASE_URL}/api/stocks`, {
            method: 'GET'
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            // 1. 將資料庫傳來的陣列，轉換成 HTML 表格
            const stockListContent = result.data.map(stock => `
                <tr>
                    <td>${stock.stock_id}</td>
                    <td>${stock.stock_name}</td>
                    <td>${stock.current_price}</td>
                </tr>
            `).join('');
            document.getElementById('stock-list').innerHTML = stockListContent;

            // 2. 自動更新全域防呆清單！
            // 把陣列轉換成 { "2330": 600, "2454": 900 } 的格式存起來
            availableStocks = {};
            result.data.forEach(stock => {
                availableStocks[stock.stock_id] = stock.current_price;
            });
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// ==========================================
// 4. 買入交易核心 (串接真實 /api/buy)
// ==========================================
async function buyStock() {
    const stockId = document.getElementById('buy-stock-id').value;
    const quantity = parseInt(document.getElementById('buy-quantity').value);
    
    if (!stockId || !quantity || quantity <= 0) {
        alert("請輸入正確的股票代號與數量"); return;
    }

    if (!availableStocks[stockId]) {
        alert("交易失敗：查無此股票代號！請確認市場報價區的可交易清單。");
        return; 
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/buy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, stock_id: stockId, quantity: quantity })
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            alert(result.message);
            // 根據後端回傳的最新餘額更新畫面
            currentUser.balance = result.remaining_balance; 
            updateBalanceDisplay();
            
            // 重新向後端索取最新的歷史紀錄與庫存
            getHistory();
            updateInventoryDisplay();

            document.getElementById('buy-stock-id').value = '';
            document.getElementById('buy-quantity').value = '';
        } else {
            alert("交易失敗：" + result.message);
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// ==========================================
// 5. 賣出股票 (串接真實 /api/sell)
// ==========================================
async function sellStock() {
    const stockId = document.getElementById('sell-stock-id').value;
    const quantity = parseInt(document.getElementById('sell-quantity').value);
    
    if (!stockId || !quantity || quantity <= 0) {
        alert("請輸入正確的股票代號與數量"); return;
    }
    if (!availableStocks[stockId]) {
        alert("交易失敗：查無此股票代號！請確認市場報價區的可交易清單。");
        return; 
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/sell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, stock_id: stockId, quantity: quantity })
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            alert(result.message);
            currentUser.balance = result.remaining_balance;
            updateBalanceDisplay();
            
            getHistory();
            updateInventoryDisplay();

            document.getElementById('sell-stock-id').value = '';
            document.getElementById('sell-quantity').value = '';
        } else {
            alert("交易失敗：" + result.message);
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// ==========================================
// 6. 取得歷史紀錄 (串接真實 /api/history)
// ==========================================
async function getHistory() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email })
        });
        const result = await response.json();

        if (result.data.length === 0) {
            document.getElementById('history-list').innerHTML = `<tr><td colspan="6" style="text-align: center;">尚無交易紀錄</td></tr>`;
            return;
        }

        // 注意：後端傳來的時間欄位叫做 order_time
        const historyListContent = result.data.map(record => `
            <tr>
                <td>${record.order_id || '-'}</td>
                <td>${record.stock_id}</td>
                <td><span class="badge ${record.action === 'buy' ? 'badge-buy' : 'badge-sell'}">${record.action}</span></td>
                <td>${record.price}</td>
                <td>${record.quantity}</td>
                <td>${record.order_time}</td>
            </tr>
        `).join('');

        document.getElementById('history-list').innerHTML = historyListContent;
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// ==========================================
// 7. 取得庫存顯示 (串接真實 /api/inventory)
// ==========================================
async function updateInventoryDisplay() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/inventory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email })
        });
        const result = await response.json();

        let inventoryHtml = "";
        
        if (result.data && result.data.length > 0) {
            // 注意：後端傳來的數量欄位叫做 total_quantity
            result.data.forEach(item => {
                inventoryHtml += `
                    <tr>
                        <td>${item.stock_id} (${item.stock_name})</td>
                        <td style="font-weight: bold; color: #2563eb;">${item.total_quantity.toLocaleString()}</td>
                    </tr>
                `;
            });
        } else {
            inventoryHtml = `<tr><td colspan="2" style="text-align: center; color: #64748b;">目前無持有股票</td></tr>`;
        }

        document.getElementById('inventory-list').innerHTML = inventoryHtml;
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// ==========================================
// 畫面控制與 UI 小工具
// ==========================================
function showDashboard() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('history-section').classList.remove('hidden');
    
    document.getElementById('display-name').innerText = currentUser.name;
    updateBalanceDisplay();
    
    getStocks();
    getHistory();
    updateInventoryDisplay();
}

function updateBalanceDisplay() {
    document.getElementById('display-balance').innerText = currentUser.balance.toLocaleString();
}

// ==========================================
// 8. 登出功能
// ==========================================
function logout() {
    // 1. 清空本地的暫存使用者資料
    currentUser = {
        email: "",
        name: "",
        balance: 0
    };
    
    // 2. 清空密碼輸入框 (保護隱私，Email 可以留著方便下次登入)
    document.getElementById('user-password').value = '';
    
    // 3. 隱藏交易大廳與歷史紀錄，重新顯示登入區塊
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('history-section').classList.add('hidden');
    document.getElementById('auth-section').classList.remove('hidden');
    
    // 4. 切換回登入頁籤 (以防使用者是在註冊畫面登出的)
    switchAuthTab('login');
    
    alert("已成功登出！期待您再次回來交易。");
}