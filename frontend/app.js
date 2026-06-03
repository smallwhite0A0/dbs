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
let previousPrices = {}; // 👈 新增這行：用來記錄前一次股價，才能算漲跌幅



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
// 3. 取得股票清單 (升級版：大盤模擬、視窗分類與即時跑馬燈)
// ==========================================
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
            let tickerHtml = ""; // 👈 新增：用來打包跑馬燈的字串
            let weightSum = 0;

            availableStocks = {};

            // 迴圈掃描後端傳來的每一檔股票
            result.data.forEach(stock => {
                availableStocks[stock.stock_id] = {
                    name: stock.stock_name,
                    price: stock.current_price
                };

                // 產生全部股票的 HTML
                allListHtml += `
                    <tr>
                        <td>${stock.stock_id}</td>
                        <td>${stock.stock_name}</td>
                        <td style="font-weight: bold;">$${stock.current_price}</td>
                    </tr>
                `;

                // 針對五大權值股的特別處理
                if (MAJOR_STOCKS.includes(stock.stock_id)) {
                    majorListHtml += `
                        <tr>
                            <td>${stock.stock_id}</td>
                            <td style="font-weight:bold; color: #2563eb;">${stock.stock_name}</td>
                            <td style="font-weight:bold;">$${stock.current_price}</td>
                        </tr>
                    `;
                    weightSum += stock.current_price;

                    // ==========================================
                    // 🌟 動態跑馬燈計算邏輯 🌟
                    // ==========================================
                    // 1. 抓取上一次的價格。如果剛登入沒有紀錄，就稍微打個 99 折作為「昨收價」，讓第一次載入就有紅綠變化！
                    let prevPrice = previousPrices[stock.stock_id];
                    if (!prevPrice) {
                        prevPrice = stock.current_price * 0.99; 
                    }

                    const diff = stock.current_price - prevPrice;
                    const diffPct = (diff / prevPrice) * 100;

                    let arrow = "■";
                    let colorStyle = "color: #94a3b8;"; // 平盤灰
                    let sign = "";

                    // 台股買紅賣綠邏輯
                    if (diff > 0) {
                        arrow = "▲"; colorStyle = "color: #ef4444;"; sign = "+"; // 漲紅
                    } else if (diff < 0) {
                        arrow = "▼"; colorStyle = "color: #22c55e;"; sign = "";  // 跌綠
                    }

                    // 把這檔股票塞進跑馬燈字串裡
                    tickerHtml += `<span class="ticker-item"><span style="${colorStyle} font-weight: bold;">${arrow} ${stock.stock_name} (${stock.stock_id}) ${stock.current_price.toFixed(2)} (${sign}${diffPct.toFixed(2)}%)</span></span>`;

                    // 2. 更新紀錄，給 5 秒後的下一次跳動使用
                    previousPrices[stock.stock_id] = stock.current_price;
                }
            });

            // 將 HTML 塞入表格
            document.getElementById('stock-list').innerHTML = majorListHtml;
            document.getElementById('all-stock-list').innerHTML = allListHtml;

            // 👇 注入跑馬燈畫面，並在最後加上系統公告
            const tickerContainer = document.getElementById('dynamic-ticker');
            if (tickerContainer) {
                tickerContainer.innerHTML = tickerHtml + `<span class="ticker-item" style="color: #fbbf24; font-weight: bold;">※ 系統公告：期末專案大成功！台股交易系統即時連線中 ※</span>`;
            }

            // 虛擬加權指數
            const simulatedTaiex = 15000 + (weightSum * 1.7);
            document.getElementById('taiex-index').innerText = simulatedTaiex.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            
            if (document.getElementById('order-stock-id') && document.getElementById('order-stock-id').value !== '') {
                searchStock(); 
            }
        }
    } catch (error) {
        console.error("連線錯誤:", error);
    }
}
// ==========================================
// 彈出視窗的控制開關 (剛剛不小心被覆蓋掉的兩兄弟)
// ==========================================
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
                            <td>
                                <button onclick="jumpToOrder('${item.stock_id}')" style="background-color: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">下單</button>
                            </td>
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
                            <td>$${item.avg_buy_price_history}</td> 
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
    //startMarketSimulation();
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

// 切換買進/賣出按鈕樣式 (台股買紅賣綠專業版)
function setOrderType(type) {
    currentOrderType = type;
    const btnBuy = document.getElementById('btn-type-buy');
    const btnSell = document.getElementById('btn-type-sell');
    const btnSubmit = document.getElementById('btn-submit-order');

    // 設定台股標準色票：紅色(買進)、綠色(賣出)、灰色(未選中)
    const COLOR_BUY = '#ef4444';
    const COLOR_SELL = '#22c55e';
    const COLOR_INACTIVE = '#475569';

    if (type === 'buy') {
        // 買進模式：買進鈕變紅，賣出鈕變灰
        btnBuy.style.backgroundColor = COLOR_BUY;
        btnBuy.style.color = 'white';
        btnBuy.style.border = 'none';
        
        btnSell.style.backgroundColor = COLOR_INACTIVE;
        btnSell.style.color = '#94a3b8'; // 稍微暗一點的字體
        
        // 下方的確認按鈕跟著變紅
        btnSubmit.style.backgroundColor = COLOR_BUY;
        btnSubmit.style.color = 'white';
        btnSubmit.innerText = '確認買進';
    } else {
        // 賣出模式：賣出鈕變綠，買進鈕變灰
        btnBuy.style.backgroundColor = COLOR_INACTIVE;
        btnBuy.style.color = '#94a3b8';
        
        btnSell.style.backgroundColor = COLOR_SELL;
        btnSell.style.color = 'white';
        btnSell.style.border = 'none';
        
        // 下方的確認按鈕跟著變綠
        btnSubmit.style.backgroundColor = COLOR_SELL;
        btnSubmit.style.color = 'white';
        btnSubmit.innerText = '確認賣出';
    }
}

// ==========================================
// 📊 ADSP 量化圖表與彈出視窗邏輯
// ==========================================
let kChart = null;  
let kdChart = null; 
let currentStockData = null; // 暫存伺服器傳來的 K 線資料
let currentSignal = false;   // 暫存最新的 ADSP 訊號

// 🚀 智慧搜尋：只負責「抓資料」，絕對不畫圖
async function searchStock() {
    const stockId = document.getElementById('order-stock-id').value;
    const nameDisplay = document.getElementById('order-stock-name');
    const priceDisplay = document.getElementById('order-stock-price');

    if (!stockId || stockId.length < 4) {
        nameDisplay.innerText = '---';
        priceDisplay.innerText = '---';
        currentSelectedStockPrice = 0;
        currentStockData = null; 
        calculateTotal();
        return;
    }

    try {
       const response = await fetch(`${API_BASE_URL}/api/stock_analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock_id: stockId, timeframe: currentTimeframe }) // 🌟 新增 timeframe
        });
        const result = await response.json();

        if (response.ok && result.status === "success") {
           nameDisplay.innerText = availableStocks[stockId] ? availableStocks[stockId].name : result.stock_name;
            
            const latestData = result.data[result.data.length - 1];
            currentSelectedStockPrice = latestData.close;
            priceDisplay.innerText = currentSelectedStockPrice.toFixed(2);

            // 💾 把資料「存起來」，這裡絕對不呼叫畫圖函數！
            currentStockData = result.data;
            currentSignal = result.latest_signal;
            
        } else {
            nameDisplay.innerText = '查無代號 / 網路異常';
            priceDisplay.innerText = '---';
            currentStockData = null;
        }
    } catch (error) {
        console.error("即時分析連線錯誤:", error);
    }
    calculateTotal(); 
}

// 🪟 開啟技術分析視窗
function openTechModal() {
    if (!currentStockData) {
        alert("請先輸入有效的股票代號並等待資料載入！");
        return;
    }
    
    document.getElementById('tech-modal').classList.remove('hidden');
    
    // 🌟 關鍵修復 2：每次重畫圖表時，強制把所有 HTML 的 Checkbox 打勾，讓 UI 與圖表預設狀態完美同步！
    const checkboxes = document.querySelectorAll('#tech-modal input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    
    // 全場只宣告一次 latestData，放在這裡統籌使用
    const latestData = currentStockData[currentStockData.length - 1]; 
    const badge = document.getElementById('signal-badge');
    
    // 1. 更新紅綠燈訊號
    if (currentSignal) {
        if (latestData.z_score < -2) {
            badge.innerText = "🚨 極端超跌抄底訊號 (Z-Score < -2，具備均值回歸潛力！)";
            badge.style.backgroundColor = "#8b5cf6"; 
        } else {
            badge.innerText = "🚀 滿足買進條件 (AKF 趨勢成型 且 KD 黃金交叉！)";
            badge.style.backgroundColor = "#ef4444"; 
        }
    } else {
        badge.innerText = "⏳ 未達條件 (趨勢偏弱或震盪，等待 Z-Score 超跌點)";
        badge.style.backgroundColor = "#475569"; 
    }

    // 2. 顯示 K, D 數值
    document.getElementById('latest-k').innerText = latestData.k_val ? latestData.k_val.toFixed(2) : "計算中";
    document.getElementById('latest-d').innerText = latestData.d_val ? latestData.d_val.toFixed(2) : "計算中";

    // 3. 延遲畫圖
    setTimeout(() => {
        renderSmartCharts(currentStockData);
    }, 100);
}

// 🪟 關閉技術分析視窗
function closeTechModal() {
    document.getElementById('tech-modal').classList.add('hidden');
}

// 🎨 使用 ApexCharts 繪製單一主圖 (無斷層完美版)
function renderSmartCharts(serverData) {
    const candleSeries = [];
    const ma5Series = [];  
    const ma10Series = []; 
    const ma20Series = []; 
    const ma60Series = [];
    const kalmanSeries = [];

    serverData.forEach(item => {
        // ✅ 關鍵修復 1：不要轉成 timestamp，直接用字串時間，讓 K 線一根接一根，跳過休市空白！
        const timeStr = item.time; 
        
        candleSeries.push({ x: timeStr, y: [item.open, item.high, item.low, item.close] });
        
        // 確保數值存在才畫線
        if (item.ma5 !== null) ma5Series.push({ x: timeStr, y: item.ma5 });
        if (item.ma10 !== null) ma10Series.push({ x: timeStr, y: item.ma10 });
        if (item.ma20 !== null) ma20Series.push({ x: timeStr, y: item.ma20 });
        if (item.ma60 !== null) ma60Series.push({ x: timeStr, y: item.ma60 });
        if (item.kalman !== null) kalmanSeries.push({ x: timeStr, y: item.kalman });
    });

    const mainOptions = {
        series: [
            { name: 'K線', type: 'candlestick', data: candleSeries },
            { name: '5MA', type: 'line', data: ma5Series },
            { name: '10MA', type: 'line', data: ma10Series },
            { name: '20MA', type: 'line', data: ma20Series },
            { name: '60MA', type: 'line', data: ma60Series },
            { name: 'Kalman Filter', type: 'line', data: kalmanSeries }
        ],
        chart: { 
            type: 'line', height: 420, toolbar: { show: false },
            id: 'kline-chart-id',
            animations: { enabled: false } 
        },
        stroke: { width: [1, 1.5, 1.5, 1.5, 2, 3], curve: 'smooth' },
        colors: ['#00E396', '#f472b6', '#a78bfa', '#facc15', '#ea580c', '#3b82f6'], 
        
        xaxis: { 
            type: 'category', // ✅ 關鍵修復 2：改回類別軸，徹底消除假日與夜晚斷層
            tickAmount: 8,    // ✅ 關鍵修復 3：強制 X 軸最多只顯示 8 個時間標籤，解決文字擠壓問題
            labels: { 
                formatter: function(val) {
                    if (!val) return '';
                    // 將後端傳來的 '2026-05-18 13:00' 裁切成 '05/18 13:00'，讓畫面更清爽
                    return val.substring(5, 16).replace('-', '/');
                }
            },
            tooltip: { enabled: true } 
        },
        dataLabels: { enabled: false },
        legend: { show: false } 
    };

    if (kChart) kChart.destroy();
    kChart = new ApexCharts(document.getElementById("kline-chart"), mainOptions);
    kChart.render();
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

// ==========================================
// 12. 快捷下單跳轉功能
// ==========================================
function jumpToOrder(stockId) {
    // 1. 切換到下單分頁
    switchMainTab('order');
    
    // 2. 自動幫使用者填入股票代號
    document.getElementById('order-stock-id').value = stockId;
    
    // 3. 觸發搜尋，立刻把這檔股票的現價跟名稱抓出來！
    searchStock();
    
    // 4. 預設切換為「買進」模式
    setOrderType('buy');
    
    // 5. 貼心小設計：把畫面滾動到最上方，確保使用者看到下單介面
    window.scrollTo(0, 0);
}

let currentTimeframe = '1d'; // 預設使用日線

// 🌟 加上 async 讓函數可以「等待」
async function changeTimeframe(tf) {
    currentTimeframe = tf;
    
    // 動態更新按鈕的視覺樣式
    const tfs = ['1h', '1d', '1wk', '1mo'];
    tfs.forEach(t => {
        const btn = document.getElementById(`btn-tf-${t}`);
        if (btn) {
            if (t === tf) {
                btn.style.border = "1px solid #3b82f6";
                btn.style.background = "#eff6ff";
                btn.style.color = "#1d4ed8";
                btn.style.fontWeight = "bold";
            } else {
                btn.style.border = "1px solid #cbd5e1";
                btn.style.background = "#f8fafc";
                btn.style.color = "#475569";
                btn.style.fontWeight = "normal";
            }
        }
    });

    // 🌟 1. 這裡一定要有 await！強迫程式在這裡「停下來等」，直到後端把新資料算完傳回來
    await searchStock();

    // 🌟 2. 資料確定更新完畢後，強制重新執行一次開視窗的動作，讓它用新資料重畫圖表
    if (!document.getElementById('tech-modal').classList.contains('hidden')) {
        openTechModal(); 
    }
}

// 👁️ 動態切換圖表上的指標線 (ApexCharts 內建 API)
function toggleIndicator(seriesName) {
    if (kChart) {
        // 這個指令會根據該線條目前的狀態，自動隱藏或顯示它
        kChart.toggleSeries(seriesName);
    }
}