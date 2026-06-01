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
// 3. 取得股票清單 (升級版：大盤模擬與視窗分類)
// ==========================================
// 定義你要顯示在首頁的 5 大核心權值股
const MAJOR_STOCKS = ["2330", "2317", "2454", "7769", "8299","0050","3131"];

async function getStocks() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/stocks`, { 
            method: 'GET',
            cache: 'no-store' 
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            let majorListHtml = "";
            let allListHtml = "";
            let weightSum = 0; // 用來計算虛擬加權指數

            availableStocks = {};

            // 迴圈掃描後端傳來的每一檔股票
            result.data.forEach(stock => {
                availableStocks[stock.stock_id] = {
                    name: stock.stock_name,
                    price: stock.current_price
                };

                // 產生全部股票的 HTML (放在彈出視窗用)
                allListHtml += `
                    <tr>
                        <td>${stock.stock_id}</td>
                        <td>${stock.stock_name}</td>
                        <td style="font-weight: bold;">$${stock.current_price}</td>
                    </tr>
                `;

                // 判斷這檔股票是不是我們定義的 5 大權值股？
                if (MAJOR_STOCKS.includes(stock.stock_id)) {
                    majorListHtml += `
                        <tr>
                            <td>${stock.stock_id}</td>
                            <td style="font-weight:bold; color: #2563eb;">${stock.stock_name}</td>
                            <td style="font-weight:bold;">$${stock.current_price}</td>
                        </tr>
                    `;
                    // 把權值股的價格累加，用來模擬大盤波動
                    weightSum += stock.current_price;
                }
            });

            // 將 HTML 塞入對應的表格中
            document.getElementById('stock-list').innerHTML = majorListHtml;
            document.getElementById('all-stock-list').innerHTML = allListHtml;

            // 🔮 神奇的大盤模擬公式：基期 15000 點 + (權值股總和 x 2.8倍)
            // 這樣只要台積電跳動，大盤指數就會跟著逼真地跳動！
            const simulatedTaiex = 15000 + (weightSum * 2.8);
            document.getElementById('taiex-index').innerText = simulatedTaiex.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            if (document.getElementById('order-stock-id') && document.getElementById('order-stock-id').value !== '') {
                searchStock(); 
            }
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}

// 彈出視窗的控制開關
function openAllStocksModal() {
    document.getElementById('all-stocks-modal').classList.remove('hidden');
}

function closeAllStocksModal() {
    document.getElementById('all-stocks-modal').classList.add('hidden');
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
// 7. 取得庫存與損益顯示 (終極專業版)
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
        let realizedHtml = "";
        
        if (result.data && result.data.length > 0) {
            result.data.forEach(item => {
                // 輔助函數：處理台股紅綠顏色與加號顯示
                const getPnLColor = (num) => num > 0 ? '#ef4444' : (num < 0 ? '#22c55e' : '#333');
                const formatNum = (num) => num > 0 ? `+${num.toLocaleString()}` : num.toLocaleString();

                // --- 1. 處理未實現庫存 (只要還有餘額) ---
                if (item.inventory > 0) {
                    const unrealizedColor = getPnLColor(item.unrealized_pnl);
                    inventoryHtml += `
                        <tr>
                            <td style="font-weight: bold;">${item.stock_name} (${item.stock_id})</td>
                            <td>${item.inventory.toLocaleString()} 股</td>
                            <td>$${item.avg_cost}</td>
                            <td>$${item.current_price}</td>
                            <td style="color: ${unrealizedColor}; font-weight: bold;">${formatNum(item.unrealized_pnl)}</td>
                            <td style="color: ${unrealizedColor}; font-weight: bold;">${formatNum(item.unrealized_pnl_pct)}%</td>
                        </tr>
                    `;
                }

                // --- 2. 處理已實現損益 (只要有賣出過) ---
                if (item.sold_qty > 0) {
                    const realizedColor = getPnLColor(item.realized_pnl);
                    realizedHtml += `
                        <tr>
                            <td style="font-weight: bold;">${item.stock_name} (${item.stock_id})</td>
                            <td>$${item.avg_cost}</td>
                            <td>$${item.avg_sell_price}</td>
                            <td style="color: ${realizedColor}; font-weight: bold;">${formatNum(item.realized_pnl)}</td>
                            <td style="color: ${realizedColor}; font-weight: bold;">${formatNum(item.realized_pnl_pct)}%</td>
                        </tr>
                    `;
                }
            });
        } 

        // 如果沒有資料時的防呆顯示
        if (!inventoryHtml) inventoryHtml = `<tr><td colspan="6" style="text-align: center; color: #64748b;">目前無持有股票</td></tr>`;
        if (!realizedHtml) realizedHtml = `<tr><td colspan="5" style="text-align: center; color: #64748b;">目前無歷史結算紀錄</td></tr>`;

        // 渲染到網頁上
        document.getElementById('inventory-list').innerHTML = inventoryHtml;
        document.getElementById('realized-list').innerHTML = realizedHtml;
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
    // history-section 已經被我們搬進去了，所以不用寫了
    
    document.getElementById('display-name').innerText = currentUser.name;
    updateBalanceDisplay();
    
    getStocks();
    getHistory();
    updateInventoryDisplay();

    // 登入時，預設顯示「大盤權值股」分頁
    switchMainTab('market');
    startMarketSimulation();
}

function updateBalanceDisplay() {
    document.getElementById('display-balance').innerText = currentUser.balance.toLocaleString();
}

// ==========================================
// 8. 登出功能
// ==========================================
function logout() {
    // 👇 新增這行：登出時停止大盤跳動
    if (marketInterval) clearInterval(marketInterval);

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

// ==========================================
// 9. 模擬大盤自動造市 (進階創意功能)
// ==========================================
let marketInterval = null; // 用來存放定時器，方便之後關閉

function startMarketSimulation() {
    // 為了防呆，啟動前先清空舊的定時器，避免重複執行
    if (marketInterval) {
        clearInterval(marketInterval);
    }

    // 每 5000 毫秒 (5秒) 執行一次大括號內的動作
    marketInterval = setInterval(async () => {
        try {
            // 1. 呼叫後端造市 API，請老天爺幫股票洗牌
            await fetch(`${API_BASE_URL}/api/simulate_market`, { method: 'POST' });
            
            // 2. 價格洗牌後，直接呼叫你寫好的 getStocks() 重新抓取並更新網頁畫面！
            await getStocks(); 
            // 👇 新增這行！更新右邊的庫存與未實現損益
            await updateInventoryDisplay();
            
        } catch (error) {
            console.error("造市模擬連線錯誤:", error);
        }
    }, 5000);
}


// ==========================================
// 9. 主選單分頁切換邏輯 (Google 風格)
// ==========================================
function switchMainTab(tabName) {
    // 定義所有的分頁名稱
    const tabs = ['market', 'inventory', 'realized', 'order', 'history'];

    tabs.forEach(tab => {
        // 控制標籤按鈕的顏色與底線 (active)
        const btn = document.getElementById(`nav-${tab}`);
        if (tab === tabName) btn.classList.add('active');
        else btn.classList.remove('active');

        // 控制內容區塊的顯示與隱藏 (hidden)
        const content = document.getElementById(`content-${tab}`);
        if (tab === tabName) content.classList.remove('hidden');
        else content.classList.add('hidden');
    });
}

// ==========================================
// 11. 智慧交易終端機邏輯
// ==========================================
let currentOrderType = 'buy'; // 預設狀態為買進
let currentSelectedStockPrice = 0; // 暫存使用者目前選中的股票價格

// 切換買進/賣出按鈕樣式
function setOrderType(type) {
    currentOrderType = type;
    const btnBuy = document.getElementById('btn-type-buy');
    const btnSell = document.getElementById('btn-type-sell');
    const btnSubmit = document.getElementById('btn-submit-order');

    if (type === 'buy') {
        btnBuy.classList.add('active');
        btnSell.classList.remove('active');
        btnSubmit.className = 'submit-order-btn buy-mode';
        btnSubmit.innerText = '確認買進';
    } else {
        btnBuy.classList.remove('active');
        btnSell.classList.add('active');
        btnSubmit.className = 'submit-order-btn sell-mode';
        btnSubmit.innerText = '確認賣出';
    }
}

// 根據輸入的代號，即時搜尋並顯示資訊
function searchStock() {
    const stockId = document.getElementById('order-stock-id').value;
    const nameDisplay = document.getElementById('order-stock-name');
    const priceDisplay = document.getElementById('order-stock-price');

    // 如果輸入的代號在我們剛剛存的 availableStocks 裡面找得到
    if (availableStocks[stockId]) {
        nameDisplay.innerText = availableStocks[stockId].name; // 顯示名稱
        currentSelectedStockPrice = availableStocks[stockId].price; // 記下價格
        priceDisplay.innerText = currentSelectedStockPrice.toLocaleString();
    } else {
        // 找不到就顯示 ---
        nameDisplay.innerText = '---';
        priceDisplay.innerText = '---';
        currentSelectedStockPrice = 0;
    }
    // 價格變了，順便重新計算底下總金額
    calculateTotal(); 
}

// 乘法運算：算出預估總金額
function calculateTotal() {
    const quantity = parseInt(document.getElementById('order-quantity').value) || 0;
    const total = currentSelectedStockPrice * quantity;
    document.getElementById('order-total-price').innerText = total.toLocaleString();
}

// 最終送出訂單
async function submitSmartOrder() {
    const stockId = document.getElementById('order-stock-id').value;
    const quantity = parseInt(document.getElementById('order-quantity').value);

    if (!availableStocks[stockId]) {
        alert("交易失敗：查無此股票代號！"); return;
    }
    if (!quantity || quantity <= 0) {
        alert("請輸入正確的交易數量！"); return;
    }

    // 根據 currentOrderType 決定要打買入還是賣出的 API
    const endpoint = currentOrderType === 'buy' ? '/api/buy' : '/api/sell';

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, stock_id: stockId, quantity: quantity })
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
            alert(result.message);
            
            // 更新餘額、歷史紀錄、庫存
            currentUser.balance = result.remaining_balance;
            updateBalanceDisplay();
            await getHistory();
            await updateInventoryDisplay();

            // 交易成功後，貼心地幫使用者清空輸入框
            document.getElementById('order-stock-id').value = '';
            document.getElementById('order-quantity').value = '';
            searchStock(); // 重置畫面
        } else {
            alert("交易失敗：" + result.message);
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}