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

// 🌟 補回這行：定義你要顯示在大盤區塊的權值股 (可自由替換你資料庫裡有的代號)
const MAJOR_STOCKS = ["2330", "2317", "2454", "2308", "3711"];

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
// 3. 取得股票清單 (跑馬燈專屬權值股版)
// ==========================================
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
            let tickerHtml = ""; 
            let weightSum = 0;

            availableStocks = {};

            // 迴圈掃描後端傳來的「每一檔」資料庫股票
            result.data.forEach(stock => {
                // 強制將價格轉為數字，名稱防空值
                let currentPrice = Number(stock.current_price) || 0;
                let stockName = stock.stock_name || stock.stock_id;

                availableStocks[stock.stock_id] = {
                    name: stockName,
                    price: currentPrice
                };

                // 產生全部股票的 HTML (詳細報價區)
                allListHtml += `
                    <tr>
                        <td>${stock.stock_id}</td>
                        <td>${stockName}</td>
                        <td style="font-weight: bold;">$${currentPrice.toFixed(2)}</td>
                    </tr>
                `;

                // 🛡️ 針對五大權值股的特別處理 (包含表格 與 跑馬燈)
                if (MAJOR_STOCKS.includes(stock.stock_id)) {
                    // 1. 加入大盤表格
                    majorListHtml += `
                        <tr>
                            <td>${stock.stock_id}</td>
                            <td style="font-weight:bold; color: #2563eb;">${stockName}</td>
                            <td style="font-weight:bold;">$${currentPrice.toFixed(2)}</td>
                        </tr>
                    `;
                    weightSum += currentPrice;

                    // ==========================================
                    // 🌟 2. 加入動態跑馬燈 (只在這裡執行，過濾掉其他股票)
                    // ==========================================
                    let prevPrice = previousPrices[stock.stock_id];
                    if (!prevPrice || prevPrice === 0) {
                        prevPrice = currentPrice * 0.99; 
                    }

                    const diff = currentPrice - prevPrice;
                    const diffPct = (diff / prevPrice) * 100;

                    let arrow = "■";
                    let colorStyle = "color: #94a3b8;"; 
                    let sign = "";

                    if (diff > 0) {
                        arrow = "▲"; colorStyle = "color: #ef4444;"; sign = "+"; 
                    } else if (diff < 0) {
                        arrow = "▼"; colorStyle = "color: #22c55e;"; sign = "";  
                    }

                    tickerHtml += `<span class="ticker-item" style="margin-right: 25px;"><span style="${colorStyle} font-weight: bold;">${arrow} ${stockName} (${stock.stock_id}) ${currentPrice.toFixed(2)} (${sign}${diffPct.toFixed(2)}%)</span></span>`;
                }

                // 更新紀錄，給下一次跳動使用 (所有股票都更新以備不時之需)
                previousPrices[stock.stock_id] = currentPrice;
            });

            // 將 HTML 塞入表格
            document.getElementById('stock-list').innerHTML = majorListHtml;
            document.getElementById('all-stock-list').innerHTML = allListHtml;

            // 注入跑馬燈畫面
            const tickerContainer = document.getElementById('dynamic-ticker');
            if (tickerContainer) {
                tickerContainer.innerHTML = tickerHtml + `<span class="ticker-item" style="color: #fbbf24; font-weight: bold; margin-right: 25px;">※ 系統公告：期末專案大成功！台股交易系統即時連線中 ※</span>`;
            }

            // ==========================================
            // 🌟 接收並顯示真實台灣加權指數
            // ==========================================
            let realTaiex = result.taiex;
            if (realTaiex && realTaiex !== "---") {
                document.getElementById('taiex-index').innerText = Number(realTaiex).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            } else {
                document.getElementById('taiex-index').innerText = "連線異常";
            }
            
            // 恢復搜尋框連動
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
            // 🌟 關鍵升級：把從 Yahoo 抓到的新標的，動態註冊到前端的可交易清單中！
            if (!availableStocks[stockId]) {
                availableStocks[stockId] = {
                    name: result.stock_name,
                    price: result.data[result.data.length - 1].close
                };
            }
            
            // 顯示名稱 (現在一定找得到名字了)
            nameDisplay.innerText = availableStocks[stockId].name;
            
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
    
    const checkboxes = document.querySelectorAll('#tech-modal input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    
    const latestData = currentStockData[currentStockData.length - 1]; 
    const badge = document.getElementById('signal-badge');
    
   // 取得最新一天的資料 (今日)
    const curr = currentStockData[currentStockData.length - 1]; 
    // 取得前一天的資料 (昨日) - 用來判斷是否發生「交叉」穿越
    const prev = currentStockData.length > 1 ? currentStockData[currentStockData.length - 2] : curr;
    
    // ==========================================
    // 🤖 ADSP 量化大腦：三大策略與防追高判定 (Priority Logic)
    // ==========================================
    let signalText = "⏳ 未達進場條件 (趨勢偏弱或震盪，建議觀望)";
    let signalColor = "#475569"; // 預設觀望灰

    // 【防呆 A】極端超買逃頂 (優先級最高，保護獲利)
    if (curr.z_score > 2.0) {
        signalText = "🔥 停利訊號：極端超買逃頂 (Z-Score > 2，隨時面臨劇烈回檔！)";
        signalColor = "#10b981"; // 台股賣出綠
    } 
    // 【防呆 B】雙線死亡交叉 (長線跌破)
    else if (prev.tvkf >= prev.tikf && curr.tvkf < curr.tikf) {
        signalText = "📉 停損/停利訊號：雙線死亡交叉 (動能衰退，建議出場！)";
        signalColor = "#10b981"; 
    } 
    // 🌟【新增！防呆 C】防追高機制：漲幅過大，乖離或 KD 過熱
    else if (curr.tvkf > curr.tikf && (curr.z_score >= 1.5 || curr.k_val >= 80)) {
        signalText = "⚠️ 追高風險：指標嚴重過熱，已錯過最佳買點，請觀望等回檔！";
        signalColor = "#eab308"; // 警告黃
    }
    // 【策略三】趨勢共振 (過濾掉過熱後，才是安全的波段買點)
    else if (curr.close > curr.tvkf && curr.tvkf > curr.tikf && curr.k_val > curr.d_val) {
        signalText = "🎯 策略三：趨勢共振 (三鍵齊發，波段多頭確認！)";
        signalColor = "#ef4444"; // 強勢紅
    } 
    // 【策略二】左側抄底 (極端錯殺，均值回歸)
    else if (curr.z_score < -2.0) {
        signalText = "🚨 策略二：極端超跌抄底 (Z-Score < -2，具備反彈潛力！)";
        signalColor = "#8b5cf6"; // 神秘紫
    } 
    // 【策略一】雙線黃金交叉 (昨日還在下方，今日剛突破)
    else if (prev.tvkf <= prev.tikf && curr.tvkf > curr.tikf) {
        signalText = "🚀 策略一：雙線黃金交叉 (短線動能正式突破長線價值！)";
        signalColor = "#f97316"; // 活力橘
    } 
    // 【日常狀態補充】
    else if (curr.tvkf > curr.tikf) {
        signalText = "📈 雙線偏多 (TVKF > TIKF，但動能尚未共振，可分批佈局)";
        signalColor = "#f43f5e"; // 溫和粉紅
    } 
    else if (curr.tvkf < curr.tikf) {
        signalText = "📉 雙線偏空 (TVKF < TIKF，長線價值跌破，建議觀望)";
        signalColor = "#14b8a6"; // 溫和藍綠
    }

    // 將算好的訊號與顏色輸出到畫面上
    badge.innerText = signalText;
    badge.style.backgroundColor = signalColor;
    // ==========================================

    // 2. 顯示 K, D 數值
    document.getElementById('latest-k').innerText = latestData.k_val ? latestData.k_val.toFixed(2) : "計算中";
    document.getElementById('latest-d').innerText = latestData.d_val ? latestData.d_val.toFixed(2) : "計算中";

    // 🌟 3. 新增：顯示最新收盤價、TVKF、TIKF 與 Z-Score
    document.getElementById('latest-close').innerText = latestData.close ? latestData.close.toFixed(2) : "--";
    document.getElementById('latest-tvkf').innerText = latestData.tvkf ? latestData.tvkf.toFixed(2) : "--";
    document.getElementById('latest-tikf').innerText = latestData.tikf ? latestData.tikf.toFixed(2) : "--";

    // 🌟 4. 新增：Z-Score 動態變色邏輯 (超跌深紫、超買爆紅、正常平盤灰)
    const zElem = document.getElementById('latest-zscore');
    const zVal = latestData.z_score;
    if (zVal !== undefined && zVal !== null) {
        zElem.innerText = zVal.toFixed(2);
        if (zVal <= -2.0) {
            zElem.style.color = '#8b5cf6'; // 觸發極端超跌，顯示紫色
        } else if (zVal >= 2.0) {
            zElem.style.color = '#ef4444'; // 觸發極端超買，顯示紅色
        } else {
            zElem.style.color = '#475569'; // 正常區間，顯示穩重灰
        }
    } else {
        zElem.innerText = "0.00";
        zElem.style.color = '#475569';
    }

    // 5. 延遲畫圖
    setTimeout(() => {
        renderSmartCharts(currentStockData);
    }, 100);
}

// 🪟 關閉技術分析視窗
function closeTechModal() {
    document.getElementById('tech-modal').classList.add('hidden');
}

// 🎨 使用 ApexCharts 繪製單一主圖 (支援 TVKF & TIKF 雙軌)
function renderSmartCharts(serverData) {
    const candleSeries = [];
    const ma5Series = [], ma10Series = [], ma20Series = [], ma60Series = [];
    const tvkfSeries = [];
    const tikfSeries = [];

    serverData.forEach(item => {
        const timeStr = item.time; 
        candleSeries.push({ x: timeStr, y: [item.open, item.high, item.low, item.close] });
        
        if (item.ma5 !== null) ma5Series.push({ x: timeStr, y: item.ma5 });
        if (item.ma10 !== null) ma10Series.push({ x: timeStr, y: item.ma10 });
        if (item.ma20 !== null) ma20Series.push({ x: timeStr, y: item.ma20 });
        if (item.ma60 !== null) ma60Series.push({ x: timeStr, y: item.ma60 });
        
        // 畫出兩條全新的卡爾曼線
        if (item.tvkf !== null) tvkfSeries.push({ x: timeStr, y: item.tvkf });
        if (item.tikf !== null) tikfSeries.push({ x: timeStr, y: item.tikf });
    });

    const mainOptions = {
        series: [
            { name: 'K線', type: 'candlestick', data: candleSeries },
            { name: '5MA', type: 'line', data: ma5Series },
            { name: '10MA', type: 'line', data: ma10Series },
            { name: '20MA', type: 'line', data: ma20Series },
            { name: '60MA', type: 'line', data: ma60Series },
            { name: 'TVKF (動態)', type: 'line', data: tvkfSeries },
            { name: 'TIKF (靜態)', type: 'line', data: tikfSeries }
        ],
        chart: { 
            type: 'line', height: 420, toolbar: { show: false },
            id: 'kline-chart-id', animations: { enabled: false } 
        },

// ==========================================
        // 🌟 新增這裡：強制設定台股「紅漲綠跌」顏色
        // ==========================================
        plotOptions: {
            candlestick: {
                colors: {
                    upward: '#ef4444',   // 漲：熱情台股紅
                    downward: '#22c55e'  // 跌：台股出貨綠
                },
                wick: {
                    useFillColor: true   // 讓上下影線跟著實體 K 棒同色，畫面更乾淨
                }
            }
        },
        // ==========================================

        // 🌟 TVKF 用 2px，TIKF 作為大趨勢基準用最粗的 3px
        stroke: { width: [1, 1.5, 1.5, 1.5, 2, 2, 3], curve: 'smooth' },
        
        // 🌟 配色：TVKF 是科技藍 (#3b82f6)，TIKF 是深紫羅蘭 (#8b5cf6)
        colors: ['#00E396', '#f472b6', '#a78bfa', '#facc15', '#ea580c', '#3b82f6', '#8b5cf6'], 
        
        xaxis: { 
            type: 'category', tickAmount: 8,    
            labels: { 
                formatter: function(val) {
                    if (!val) return '';
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