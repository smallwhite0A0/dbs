// 記錄目前前端停留在登入還是註冊模式 ("login" 或 "register")
let currentAuthMode = "login";

// 控制頁籤切換的函數
function switchAuthTab(mode) {
    currentAuthMode = mode;
    
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const nameField = document.getElementById('name-field');
    const submitBtn = document.getElementById('btn-auth-submit');
    
    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        nameField.classList.add('hidden'); // 登入不需要姓名，隱藏它
        submitBtn.innerText = "立即登入";
    } else {
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        nameField.classList.remove('hidden'); // 註冊需要姓名，顯示它
        submitBtn.innerText = "建立帳號 (贈送 $1,000,000)";
    }
}

// 按下大按鈕時，根據目前的模式決定呼叫哪一個原本寫好的 API 邏輯
function handleAuthSubmit() {
    if (currentAuthMode === "login") {
        login();
    } else {
        register();
    }
}

// 以下保留你原本的 let currentUser = ... 和其他代碼

// ==========================================
// 全域變數與假資料庫 (Mock Database)
// ==========================================
let currentUser = {
    email: "",
    name: "",
    balance: 0
};

// 模擬後端的歷史紀錄資料庫
let mockHistoryData = [
    { order_id: 1, stock_id: "2330", action: "buy", price: 600.0, quantity: 1000, time: "2026-05-27 10:00:00" }
];
let nextOrderId = 2; // 用來產生下一筆訂單的編號

// ==========================================
// 1. 註冊帳號 (模擬 /api/register)
// ==========================================
function register() {
    const name = document.getElementById('user-name').value;
    const email = document.getElementById('user-email').value;
    const password = document.getElementById('user-password').value;

    if (!name || !email || !password) {
        alert("請填寫完整註冊資訊！");
        return;
    }

    const requestData = { "name": name, "email": email, "password": password };
    console.log("註冊發送請求 (Mock):", requestData);

    // 模擬後端回傳：註冊成功給予 1,000,000 初始資金
    const responseData = { "status": "success", "message": "註冊成功", "balance": 1000000 };
    
    if (responseData.status === "success") {
        alert(responseData.message);
        currentUser = { email: email, name: name, balance: responseData.balance };
        showDashboard();
    }
}

// ==========================================
// 2. 使用者登入 (模擬 /api/login)
// ==========================================
function login() {
    const email = document.getElementById('user-email').value;
    const password = document.getElementById('user-password').value;

    if (!email || !password) {
        alert("請輸入 Email 與密碼！");
        return;
    }

    const requestData = { "email": email, "password": password };
    console.log("登入發送請求 (Mock):", requestData);

    // 模擬後端回傳
    const responseData = { "status": "success", "name": "王大明", "balance": 1000000 };

    if (responseData.status === "success") {
        alert("登入成功！");
        currentUser = { email: email, name: responseData.name, balance: responseData.balance };
        showDashboard();
    }
}

// ==========================================
// 3. 取得股票清單 (模擬 /api/stocks)
// ==========================================
function getStocks() {
    // 模擬後端回傳撈取資料庫提供的報價
    const responseData = {
        "status": "success",
        "data": [
            { "stock_id": "2330", "stock_name": "台積電", "current_price": 600.0 },
            { "stock_id": "2454", "stock_name": "聯發科", "current_price": 900.0 },
            { "stock_id": "2317", "stock_name": "鴻海", "current_price": 150.5 }
        ]
    };

    const stockListContent = responseData.data.map(stock => `
        <tr>
            <td>${stock.stock_id}</td>
            <td>${stock.stock_name}</td>
            <td>${stock.current_price}</td>
        </tr>
    `).join('');

    document.getElementById('stock-list').innerHTML = stockListContent;
}

// ==========================================
// 4. 買入交易核心 (模擬 /api/buy)
// ==========================================
function buyStock() {
    const stockId = document.getElementById('buy-stock-id').value;
    const quantity = parseInt(document.getElementById('buy-quantity').value);
    
    // 簡單防呆檢查
    if (!stockId || !quantity || quantity <= 0) {
        alert("請輸入正確的股票代號與數量"); 
        return;
    }

    // 模擬抓取股價 (台積電 600，聯發科 900，鴻海 150.5，其他預設 100)
    let mockPrice = 100.0;
    if (stockId === "2330") mockPrice = 600.0;
    if (stockId === "2454") mockPrice = 900.0;
    if (stockId === "2317") mockPrice = 150.5;
    
    const totalPrice = mockPrice * quantity;

    const requestData = {
        "email": currentUser.email,
        "stock_id": stockId,
        "quantity": quantity,
        "total_price": totalPrice
    };
    console.log("買入發送請求 (Mock):", requestData);

    // 模擬後端檢查餘額與回傳結果
    if (currentUser.balance >= totalPrice) {
        const remainingBalance = currentUser.balance - totalPrice;
        const responseData = { "status": "success", "message": "交易成功", "remaining_balance": remainingBalance };
        
        alert(responseData.message);
        
        // 1. 更新本地餘額與畫面
        currentUser.balance = responseData.remaining_balance;
        updateBalanceDisplay();

        // 2. 產生現在的時間字串 (格式: YYYY-MM-DD HH:MM:SS)
        const now = new Date();
        const timeString = now.getFullYear() + "-" + 
                           String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                           String(now.getDate()).padStart(2, '0') + " " + 
                           String(now.getHours()).padStart(2, '0') + ":" + 
                           String(now.getMinutes()).padStart(2, '0') + ":" + 
                           String(now.getSeconds()).padStart(2, '0');

        // 3. 把新訂單存入假的資料庫陣列
        mockHistoryData.push({
            order_id: nextOrderId++,
            stock_id: stockId,
            action: "buy",
            price: mockPrice,
            quantity: quantity,
            time: timeString
        });

        // 4. 交易成功後，立刻刷新歷史紀錄表格
        getHistory();
        updateInventoryDisplay();

        // 5. 清空輸入框
        document.getElementById('buy-stock-id').value = '';
        document.getElementById('buy-quantity').value = '';

    } else {
        alert("交易失敗：餘額不足！");
    }
}

// ==========================================
// 5. 取得歷史紀錄 (模擬 /api/history)
// ==========================================
function getHistory() {
    console.log("獲取歷史發送請求 (Mock):", { "email": currentUser.email });

    // 讀取我們模擬的陣列，回傳給畫面
    const responseData = {
        "status": "success",
        "data": mockHistoryData
    };

    // 如果歷史紀錄是空的，顯示提示
    if (responseData.data.length === 0) {
        document.getElementById('history-list').innerHTML = `<tr><td colspan="6" style="text-align: center;">尚無交易紀錄</td></tr>`;
        return;
    }

    // 將資料陣列轉換成 HTML 表格內容，反轉陣列讓最新紀錄排在最上面
    const historyListContent = [...responseData.data].reverse().map(record => `
        <tr>
            <td>${record.order_id}</td>
            <td>${record.stock_id}</td>
            <td><span class="badge ${record.action === 'buy' ? 'badge-buy' : 'badge-sell'}">${record.action}</span></td>
            <td>${record.price}</td>
            <td>${record.quantity}</td>
            <td>${record.time}</td>
        </tr>
    `).join('');

    document.getElementById('history-list').innerHTML = historyListContent;
}

// ==========================================
// 7. 計算並更新庫存顯示 (進階功能)
// ==========================================
function updateInventoryDisplay() {
    const inventory = {}; // 用來暫存各檔股票的數量，格式如：{ "2330": 1000, "2454": 500 }

    // 1. 掃描所有歷史紀錄來結算數量
    mockHistoryData.forEach(record => {
        // 如果這個股票代號還沒出現過，先把它歸零
        if (!inventory[record.stock_id]) {
            inventory[record.stock_id] = 0;
        }

        // 買入就加，賣出就減
        if (record.action === "buy") {
            inventory[record.stock_id] += record.quantity;
        } else if (record.action === "sell") {
            inventory[record.stock_id] -= record.quantity;
        }
    });

    // 2. 把算好的資料變成 HTML
    let inventoryHtml = "";
    for (const stockId in inventory) {
        // 只顯示持有數量大於 0 的股票
        if (inventory[stockId] > 0) {
            inventoryHtml += `
                <tr>
                    <td>${stockId}</td>
                    <td style="font-weight: bold; color: #2563eb;">${inventory[stockId].toLocaleString()}</td>
                </tr>
            `;
        }
    }

    // 如果全部賣光或是還沒買過，顯示提示
    if (inventoryHtml === "") {
        inventoryHtml = `<tr><td colspan="2" style="text-align: center; color: #64748b;">目前無持有股票</td></tr>`;
    }

    document.getElementById('inventory-list').innerHTML = inventoryHtml;
}

// ==========================================
// 畫面控制與 UI 小工具
// ==========================================
function showDashboard() {
    // 隱藏登入區塊，顯示大廳與歷史紀錄
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('history-section').classList.remove('hidden');
    
    // 更新畫面上的人名與餘額
    document.getElementById('display-name').innerText = currentUser.name;
    updateBalanceDisplay();
    
    // 自動載入股票清單與歷史紀錄
    getStocks();
    getHistory();
    updateInventoryDisplay();
}

function updateBalanceDisplay() {
    // 加上 toLocaleString() 讓數字有千分位逗號 (例如: 1,000,000)
    document.getElementById('display-balance').innerText = currentUser.balance.toLocaleString();
}

// ==========================================
// 6. 賣出股票與庫存檢查 (模擬 /api/sell)
// ==========================================
function sellStock() {
    const stockId = document.getElementById('sell-stock-id').value;
    const quantity = parseInt(document.getElementById('sell-quantity').value);
    
    if (!stockId || !quantity || quantity <= 0) {
        alert("請輸入正確的股票代號與數量"); 
        return;
    }

    // 【核心進階功能：庫存檢查】
    // 遍歷歷史紀錄，計算該使用者目前持有這檔股票的數量
    let ownedQuantity = 0;
    mockHistoryData.forEach(record => {
        if (record.stock_id === stockId) {
            if (record.action === "buy") ownedQuantity += record.quantity;
            if (record.action === "sell") ownedQuantity -= record.quantity;
        }
    });

    if (quantity > ownedQuantity) {
        alert(`交易失敗：庫存不足！\n你目前只有 ${ownedQuantity} 股 ${stockId}，無法賣出 ${quantity} 股。`);
        return;
    }

    // 模擬抓取股價 (與買入邏輯共用)
    let mockPrice = 100.0;
    if (stockId === "2330") mockPrice = 600.0;
    if (stockId === "2454") mockPrice = 900.0;
    if (stockId === "2317") mockPrice = 150.5;
    
    // 計算賣出獲得的總金額
    const totalGain = mockPrice * quantity;

    // 1. 賣出股票，餘額增加
    currentUser.balance += totalGain;
    updateBalanceDisplay();

    // 2. 產生時間字串
    const now = new Date();
    const timeString = now.getFullYear() + "-" + 
                       String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                       String(now.getDate()).padStart(2, '0') + " " + 
                       String(now.getHours()).padStart(2, '0') + ":" + 
                       String(now.getMinutes()).padStart(2, '0') + ":" + 
                       String(now.getSeconds()).padStart(2, '0');

    // 3. 寫入歷史紀錄 (action 設為 "sell")
    mockHistoryData.push({
        order_id: nextOrderId++,
        stock_id: stockId,
        action: "sell",
        price: mockPrice,
        quantity: quantity,
        time: timeString
    });

    // 4. 刷新歷史紀錄表格 (我們之前寫好的 CSS 會自動把 sell 標籤變成紅色)
    getHistory();
    updateInventoryDisplay();

    // 5. 清空輸入框
    document.getElementById('sell-stock-id').value = '';
    document.getElementById('sell-quantity').value = '';

    alert(`交易成功！成功賣出 ${quantity} 股 ${stockId}，獲得 $${totalGain.toLocaleString()}`);
}