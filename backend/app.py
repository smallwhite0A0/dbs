import sqlite3
import random
import yfinance as yf
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS  # 【新增】引入 CORS 套件

app = Flask(__name__)
CORS(app)  # 【新增】告訴 Flask 允許所有來源 (包含你的 5500) 來連線
DATABASE = 'stock_market.db'

# 建立資料庫連線的小工具
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row # 讓回傳的資料可以用字典的方式讀取
    return conn


# ==========================================
# 升級版 ADSP：狀態空間模型 (TVKF & TIKF)
# ==========================================
class StockKalmanFilter:
    def __init__(self, initial_price):
        self.x = np.array([[initial_price], [0.0]]) # [價格, 速度]^T
        self.P = np.array([[1.0, 0.0], [0.0, 1.0]])
        self.F = np.array([[1.0, 1.0], [0.0, 1.0]])
        self.H = np.array([[1.0, 0.0]])
        self.I = np.eye(2)

    def predict(self, Q):
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + Q
        return self.x[0, 0]

    def update(self, z, R):
        S = self.H @ self.P @ self.H.T + R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        y = z - (self.H @ self.x)
        self.x = self.x + K @ y
        self.P = (self.I - K @ self.H) @ self.P
        return self.x[0, 0]

def run_kalman_strategies(prices_series):
    N = 5 # TVKF 的滾動窗口大小
    prices = prices_series.values
    
    # 填補可能殘留的 NaN，確保矩陣運算不會崩潰
    prices = pd.Series(prices).ffill().bfill().values 
    velocities = np.diff(prices, prepend=prices[0]) 
    
    kf_dynamic = StockKalmanFilter(initial_price=prices[0])
    kf_static = StockKalmanFilter(initial_price=prices[0])
    
    tvkf_filtered, tikf_filtered = [], []
    var_price_long = np.var(prices)
    var_vel_long = np.var(velocities)
    
    # TIKF 靜態參數 (極致平滑)
    R_static = np.array([[var_price_long * 10.0]]) 
    Q_static = np.array([[var_vel_long * 0.1, 0], [0, var_vel_long * 0.1]])

    for i in range(len(prices)):
        z_k = np.array([[prices[i]]])
        
        # TVKF 動態參數 (適應高波動)
        if i < N:
            R_dynamic = np.array([[1e-2]])
            Q_dynamic = np.array([[1e-2, 0], [0, 1e-2]])
        else:
            var_price_short = np.var(prices[i-N:i])
            var_vel_short = np.var(velocities[i-N:i])
            R_dynamic = np.array([[max(var_price_short, 1e-4)]])
            Q_dynamic = np.array([[var_vel_short, 0], [0, var_vel_short]])

        # 執行遞迴
        kf_dynamic.predict(Q_dynamic)
        tvkf_filtered.append(kf_dynamic.update(z_k, R_dynamic))
        
        kf_static.predict(Q_static)
        tikf_filtered.append(kf_static.update(z_k, R_static))
        
    return pd.DataFrame({
        'TVKF': tvkf_filtered,
        'TIKF': tikf_filtered
    }, index=prices_series.index)

# ==========================================
# 金融訊號處理：動態時框抓取與 AKF+Z-Score 策略
# ==========================================
def fetch_and_calculate_indicators(stock_id, timeframe="1d"): # 🌟 接收 timeframe 參數
    ticker_tw = f"{stock_id}.TW" if not stock_id.endswith(".TW") else stock_id
    
    # 🌟 根據時框動態調整抓取長度
    period_map = {"1h": "3mo", "1d": "1y", "1wk": "5y", "1mo": "max"}
    period = period_map.get(timeframe, "1y")
    
    # 依序嘗試抓取 上市 -> 上櫃
    df = yf.download(ticker_tw, period=period, interval=timeframe)
    if df.empty:
        df = yf.download(f"{stock_id}.TWO", period=period, interval=timeframe)
        
    # 如果 1h 抓不到，降級防呆改抓日線
    if df.empty and timeframe == "1h":
        df = yf.download(ticker_tw, period="6mo", interval="1d")
        if df.empty:
            df = yf.download(f"{stock_id}.TWO", period="6mo", interval="1d")

    if df.empty:
        return None
    
   # 壓平 yfinance 新版產生的 MultiIndex 欄位名稱
    df.columns = [col[0] if isinstance(col, tuple) else col for col in df.columns]
    
    # 1. 刪除完全沒有收盤價的無效幽靈資料
    df = df.dropna(subset=['Close']) 
    # 2. 如果中間有任何欄位缺失 (例如開高低)，用「前一筆有效價格」向後填補 (Forward Fill)
    df = df.ffill()

   # ==========================================
    # 🌟 【新增：Yahoo API 亞洲時區延遲補丁 (時區免疫版)】🌟
    # ==========================================
    if not df.empty and timeframe == "1d":
        try:
            # 去抓取最近 1 天的 1 分鐘線
            df_today = yf.download(ticker_tw, period="1d", interval="1m", progress=False)
            if df_today.empty:
                df_today = yf.download(f"{stock_id}.TWO", period="1d", interval="1m", progress=False)
            
            if not df_today.empty:
                df_today.columns = [col[0] if isinstance(col, tuple) else col for col in df_today.columns]
                
                # 💎 關鍵修復 1：強制把 1m 資料的時區拔除 (tz_localize(None))，再歸零到午夜
                latest_date = df_today.index[-1].tz_localize(None).normalize() 
                
                # 💎 關鍵修復 2：確保原本的日線 df 也是沒有時區的狀態
                if df.index.tz is not None:
                    df.index = df.index.tz_localize(None)
                
                # 現在雙方都沒時區了，可以安全比對！
                if df.index[-1] < latest_date:
                    # 我們就自己把今天的 1m 線，融合成一根日 K 線
                    new_row = pd.DataFrame({
                        'Open': [float(df_today['Open'].iloc[0])], 
                        'High': [float(df_today['High'].max())], 
                        'Low': [float(df_today['Low'].min())], 
                        'Close': [float(df_today['Close'].iloc[-1])]
                    }, index=[latest_date])
                    
                    df = pd.concat([df, new_row])
                    print(f"[系統提示] 成功為 {stock_id} 補上 {latest_date.date()} 之即時日線資料！")
        except Exception as e:
            # 這樣如果有錯，終端機會精準印出原因，不會再死得不明不白
            print(f"[系統提示] 即時補丁執行略過: {e}")
    # ==========================================
    
    # 1. 計算多重均線
    df['MA5'] = df['Close'].rolling(window=5).mean()
    df['MA10'] = df['Close'].rolling(window=10).mean()
    df['MA20'] = df['Close'].rolling(window=20).mean()
    df['MA60'] = df['Close'].rolling(window=60).mean()
    
    # 2. 計算 KD (60, 3, 3)
    low_60 = df['Low'].rolling(window=60).min()
    high_60 = df['High'].rolling(window=60).max()
    df['RSV'] = 100 * ((df['Close'] - low_60) / (high_60 - low_60))
    
    k_list, d_list = [], []
    current_k, current_d = 50.0, 50.0 
    for rsv in df['RSV']:
        if pd.isna(rsv):
            k_list.append(None)
            d_list.append(None)
        else:
            current_k = (2/3) * current_k + (1/3) * rsv
            current_d = (2/3) * current_d + (1/3) * current_k
            k_list.append(current_k)
            d_list.append(current_d)
            
    df['K'] = k_list
    df['D'] = d_list
    
    # 3. 執行雙軌卡爾曼濾波去噪價格
    kf_results = run_kalman_strategies(df['Close'])
    df['TVKF'] = kf_results['TVKF']
    df['TIKF'] = kf_results['TIKF']
    
    # 4. 計算 Z-Score 乖離率 (用反應較靈敏的 TVKF 來計算殘差)
    df['Residual'] = df['Close'] - df['TVKF']
    rolling_std = df['Close'].rolling(window=20).std().bfill()
    df['Z_Score'] = df['Residual'] / rolling_std
    
    # 5. 買進策略邏輯 (突破 TVKF 趨勢即買進)
    trend_buy = (df['Close'] > df['TVKF']) & (df['K'] > df['D'])
    oversold_buy = (df['Z_Score'] < -2.0)
    df['Signal'] = trend_buy | oversold_buy 
    
    return df

# 1. 註冊 API (防呆終極版：自動產生 ID00X)
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # --- 修正版：加上 WHERE 條件，只找開頭是 'ID' 的編號，完美避開 TBD ---
        cursor.execute("SELECT id_number FROM User WHERE id_number LIKE 'ID%' ORDER BY id DESC LIMIT 1")
        last_user = cursor.fetchone()
        
        # 2. 判斷並產生新的 id_number
        if last_user:
            # 直接把最後一個 ID (例如 ID003) 轉數字加 1
            last_num = int(last_user['id_number'][2:])
            new_id_number = f"ID{last_num + 1:03d}"
        else:
            new_id_number = "ID001"

        # 將算好的 new_id_number 寫入資料庫
        cursor.execute("""
            INSERT INTO User (username, real_name, id_number, balance, email, password)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (data['name'], data['name'], new_id_number, 1000000.0, data['email'], data['password']))
        
        conn.commit()
        return jsonify({"status": "success", "message": f"註冊成功，您的專屬編號為 {new_id_number}", "balance": 1000000.0})
    except sqlite3.IntegrityError as e:
        # 我加了一行把真正的報錯印在終端機，以後就不會被誤導了！
        print(f"資料庫寫入失敗，原因: {e}") 
        return jsonify({"status": "error", "message": "Email 或帳號已存在"}), 400
    finally:
        conn.close()

# 2. 登入 API
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM User WHERE email = ? AND password = ?", (data['email'], data['password']))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return jsonify({"status": "success", "name": user['real_name'], "balance": user['balance']})
    return jsonify({"status": "error", "message": "帳號或密碼錯誤"}), 401

# 3. 交易核心 API (最關鍵評分項：Transaction 防呆機制)
@app.route('/api/buy', methods=['POST'])
def buy_stock():
    data = request.json
    email = data['email']
    stock_id = data['stock_id']
    quantity = int(data['quantity'])
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 實作助教規定的 BEGIN TRANSACTION
        cursor.execute("BEGIN TRANSACTION;")
        
        # 取得股價與餘額
        cursor.execute("SELECT current_price FROM STOCK WHERE stock_id = ?", (stock_id,))
        stock = cursor.fetchone()
        cursor.execute("SELECT balance FROM User WHERE email = ?", (email,))
        user = cursor.fetchone()
        
        if not stock or not user:
            raise Exception("找不到該股票或使用者")
            
        total_price = stock['current_price'] * quantity
        
        if user['balance'] < total_price:
            raise Exception("餘額不足，交易失敗")
            
        # 步驟A：扣款
        new_balance = user['balance'] - total_price
        cursor.execute("UPDATE User SET balance = ? WHERE email = ?", (new_balance, email))
        
        # 步驟B：新增訂單紀錄
        cursor.execute("""
            INSERT INTO Transaction_History (email, stock_id, action, price, quantity)
            VALUES (?, ?, 'buy', ?, ?)
        """, (email, stock_id, stock['current_price'], quantity))
        
        # 確保 A 與 B 都成功才 COMMIT
        conn.commit()
        return jsonify({"status": "success", "message": "買入成功", "remaining_balance": new_balance})
        
    except Exception as e:
        # 如果中間有任何錯誤，立刻 ROLLBACK，確保錢不會被白扣
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    finally:
        conn.close()

# 4. 歷史紀錄 API
@app.route('/api/history', methods=['POST'])
def history():
    email = request.json['email']
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM Transaction_History WHERE email = ? ORDER BY order_time DESC", (email,))
    records = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify({"status": "success", "data": records})

# 5. 賣出股票 API (+10分進階功能：含庫存檢查與 Transaction)
@app.route('/api/sell', methods=['POST'])
def sell_stock():
    data = request.json
    email = data['email']
    stock_id = data['stock_id']
    quantity = int(data['quantity'])
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 一樣必須啟動嚴格的 Transaction
        cursor.execute("BEGIN TRANSACTION;")
        
        # 1. 取得最新股價與使用者餘額
        cursor.execute("SELECT current_price FROM STOCK WHERE stock_id = ?", (stock_id,))
        stock = cursor.fetchone()
        cursor.execute("SELECT balance FROM User WHERE email = ?", (email,))
        user = cursor.fetchone()
        
        if not stock or not user:
            raise Exception("找不到該股票或使用者")
            
        # 2. 超猛絕招：動態計算庫存！(買入加總 - 賣出加總)
        cursor.execute("""
            SELECT IFNULL(SUM(
                CASE WHEN action = 'buy' THEN quantity
                     WHEN action = 'sell' THEN -quantity
                     ELSE 0 END
            ), 0) as inventory
            FROM Transaction_History
            WHERE email = ? AND stock_id = ?
        """, (email, stock_id))
        
        inventory_record = cursor.fetchone()
        current_inventory = inventory_record['inventory']
        
        # 3. 庫存防呆檢查
        if current_inventory < quantity:
            raise Exception(f"庫存不足！您目前僅持有 {current_inventory} 股，無法賣出 {quantity} 股。")
            
        # 4. 執行賣出邏輯 (增加餘額)
        total_price = stock['current_price'] * quantity
        new_balance = user['balance'] + total_price
        cursor.execute("UPDATE User SET balance = ? WHERE email = ?", (new_balance, email))
        
        # 5. 新增賣出紀錄
        cursor.execute("""
            INSERT INTO Transaction_History (email, stock_id, action, price, quantity)
            VALUES (?, ?, 'sell', ?, ?)
        """, (email, stock_id, stock['current_price'], quantity))
        
        # 確定錢加上去、紀錄也寫好了，才 COMMIT
        conn.commit()
        
        return jsonify({
            "status": "success", 
            "message": f"賣出成功！獲得 {total_price} 元", 
            "remaining_balance": new_balance,
            "remaining_inventory": current_inventory - quantity
        })
        
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 400
    finally:
        conn.close()

# 6. 查詢庫存與損益 API (終極防呆會計版：鎖死已實現損益)
@app.route('/api/inventory', methods=['POST'])
def inventory():
    email = request.json['email']
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. 撈取該使用者所有歷史交易紀錄，依照時間順序 (id) 排列
        cursor.execute("""
            SELECT t.stock_id, s.stock_name, s.current_price, t.action, t.price, t.quantity
            FROM Transaction_History t
            JOIN STOCK s ON t.stock_id = s.stock_id
            WHERE t.email = ?
            ORDER BY t.order_time ASC   
        """, (email,))
        
        transactions = cursor.fetchall()
        portfolio = {}
        
        # 2. 透過迴圈「重播」歷史交易，精準計算每一刻的成本與已實現損益
        for row in transactions:
            stock_id = row['stock_id']
            if stock_id not in portfolio:
                portfolio[stock_id] = {
                    'stock_name': row['stock_name'],
                    'current_price': row['current_price'],
                    'inventory': 0,
                    'total_cost': 0.0,      # 目前手上的總成本
                    'realized_pnl': 0.0,    # 已實現損益 (賣出時結算，鎖定不變！)
                    'sold_qty': 0,
                    'total_sell_revenue': 0.0,
                    'realized_cost': 0.0    # 賣出時對應的成本總和
                }
                
            p = portfolio[stock_id]
            action = row['action']
            price = row['price']
            qty = row['quantity']
            
            if action == 'buy':
                p['inventory'] += qty
                p['total_cost'] += price * qty
            elif action == 'sell':
                # 賣出時的「當下平均成本」
                current_avg_cost = p['total_cost'] / p['inventory'] if p['inventory'] > 0 else 0
                
                # 💎 關鍵修復：結算這筆賣出的損益，並加入歷史已實現損益 (完全與現在股價脫鉤)
                trade_pnl = (price - current_avg_cost) * qty
                p['realized_pnl'] += trade_pnl
                
                # 紀錄賣出相關數據 (用來算賣出均價與獲利率)
                p['sold_qty'] += qty
                p['total_sell_revenue'] += price * qty
                p['realized_cost'] += current_avg_cost * qty
                
                # 扣除庫存與對應成本
                p['inventory'] -= qty
                p['total_cost'] -= current_avg_cost * qty

        # 3. 整理最終結果傳給前端
        records = []
        for stock_id, p in portfolio.items():
            inventory = p['inventory']
            sold_qty = p['sold_qty']
            current_price = p['current_price']
            
            # 未實現：現在手上的平均成本 (會隨最新股價波動)
            avg_cost_unrealized = p['total_cost'] / inventory if inventory > 0 else 0
            unrealized_pnl = (current_price - avg_cost_unrealized) * inventory if inventory > 0 else 0
            unrealized_pnl_pct = ((current_price - avg_cost_unrealized) / avg_cost_unrealized * 100) if avg_cost_unrealized > 0 else 0
            
            # 已實現：歷史賣出的平均成本與均價 (絕對靜止)
            avg_cost_realized = p['realized_cost'] / sold_qty if sold_qty > 0 else 0
            avg_sell_price = p['total_sell_revenue'] / sold_qty if sold_qty > 0 else 0
            realized_pnl = p['realized_pnl']
            realized_pnl_pct = (realized_pnl / p['realized_cost'] * 100) if p['realized_cost'] > 0 else 0
            
            if inventory > 0 or sold_qty > 0:
                records.append({
                    "stock_id": stock_id,
                    "stock_name": p['stock_name'],
                    "inventory": inventory,
                    "sold_qty": sold_qty,
                    "avg_cost": round(avg_cost_unrealized, 2),              # 給未實現用的平均成本
                    "avg_buy_price_history": round(avg_cost_realized, 2),   # 💎 新增：專門給已實現用的買入成本
                    "avg_sell_price": round(avg_sell_price, 2),
                    "current_price": round(current_price, 2),
                    "unrealized_pnl": round(unrealized_pnl, 2),
                    "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
                    "realized_pnl": round(realized_pnl, 2),
                    "realized_pnl_pct": round(realized_pnl_pct, 2)
                })
                
        return jsonify({"status": "success", "data": records})
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    finally:
        conn.close()

# 7. 查詢所有股票最新行情 API (大盤資訊)
@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. 撈取資料庫中的個股報價
        cursor.execute("SELECT stock_id, stock_name, current_price FROM STOCK")
        stocks = [dict(row) for row in cursor.fetchall()]
        
        # 🌟 2. 關鍵新增：透過 yfinance 抓取真實的台灣加權指數 (^TWII)
        try:
            taiex_ticker = yf.Ticker("^TWII")
            # 取得最新一筆即時報價
            real_taiex = round(taiex_ticker.fast_info.last_price, 2)
        except Exception as e:
            print(f"[系統警告] 無法抓取大盤指數: {e}")
            real_taiex = "---" # 網路異常時的防呆顯示
            
        return jsonify({
            "status": "success", 
            "message": "大盤行情獲取成功",
            "data": stocks,
            "taiex": real_taiex  # 將真實大盤指數打包傳給前端！
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

# 8. 模擬市場波動 API (進階功能：自動漲跌)
@app.route('/api/simulate_market', methods=['POST'])
def simulate_market():
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT stock_id, current_price FROM STOCK")
        stocks = cursor.fetchall()
        
        for stock in stocks:
            # 隨機產生 -0.05 (-5%) 到 0.05 (+5%) 的波動率
            fluctuation = random.uniform(-0.05, 0.05)
            
            # 計算新價格並四捨五入到小數點後兩位
            old_price = stock['current_price']
            new_price = round(old_price * (1 + fluctuation), 2)
            
            # 💎 【新增：破解 0.1 元數學黑洞】
            # 如果算完發現沒變，且是低於 0.5 元的低價股，強制讓它隨機變動 ±0.01 元！
            if new_price == old_price and old_price <= 0.5:
                new_price += random.choice([-0.01, 0.01])
                new_price = round(new_price, 2) # 重新確保只有兩位數
            
            # 確保股價不會跌破 0.01 元（底線防呆）
            if new_price < 0.01:
                new_price = 0.01
                
            cursor.execute("UPDATE STOCK SET current_price = ? WHERE stock_id = ?", (new_price, stock['stock_id']))
            
        conn.commit()
        return jsonify({"status": "success", "message": "市場價格已刷新"})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/test_db', methods=['GET'])
def test_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM User")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"status": "success", "data": users})

@app.route('/api/stock_analysis', methods=['POST'])
def stock_analysis():
    data = request.json
    stock_id = data.get('stock_id')
    timeframe = data.get('timeframe', '1d') # 🌟 關鍵：接收前端傳來的 timeframe
    
    if not stock_id:
        return jsonify({"status": "error", "message": "請提供股票代號"}), 400
        
    # 🌟 關鍵：將 timeframe 傳入計算函數中
    df = fetch_and_calculate_indicators(stock_id, timeframe)
    
    if df is None or df.empty:
        return jsonify({"status": "error", "message": "無法獲取該股票數據，請確認代號是否正確"}), 400
        
    # 只取最近 100 筆 60 分鐘 K 線資料傳給前端畫圖，避免資料量過大
    df_recent = df.tail(100)
    
    chart_data = []
    for timestamp, row in df_recent.iterrows():
        chart_data.append({
            "time": timestamp.strftime('%Y-%m-%d %H:%M'), 
            "open": round(float(row['Open']), 2),
            "high": round(float(row['High']), 2),
            "low": round(float(row['Low']), 2),
            "close": round(float(row['Close']), 2),
            "ma5": round(float(row['MA5']), 2) if not pd.isna(row['MA5']) else None,
            "ma10": round(float(row['MA10']), 2) if not pd.isna(row['MA10']) else None,
            "ma20": round(float(row['MA20']), 2) if not pd.isna(row['MA20']) else None,
            "ma60": round(float(row['MA60']), 2) if not pd.isna(row['MA60']) else None,
            "k_val": round(float(row['K']), 2) if not pd.isna(row['K']) else None,
            "d_val": round(float(row['D']), 2) if not pd.isna(row['D']) else None,
            
            # ✅ 修復：加上 pd.isna 判斷，避免空值造成 float() 當機
            "tvkf": round(float(row['TVKF']), 2) if not pd.isna(row['TVKF']) else None,
            "tikf": round(float(row['TIKF']), 2) if not pd.isna(row['TIKF']) else None,
            "z_score": round(float(row['Z_Score']), 2) if not pd.isna(row['Z_Score']) else 0,
            
            # ✅ 修復：刪除重複的 kalman 與 signal，只留一個
            "signal": bool(row['Signal'])
        })
    # 🌟 透過 yfinance 動態抓取真實公司名稱 (加入錯誤處理確保不當機)
    try:
        # 取得公司資訊字典
        stock_info = yf.Ticker(f"{stock_id}.TW").info
        if 'shortName' not in stock_info: # 如果上市找不到，改找上櫃
            stock_info = yf.Ticker(f"{stock_id}.TWO").info
        
        # 從字典中提取名稱，若沒有則預設回傳代號
        real_stock_name = stock_info.get('shortName', stock_info.get('longName', str(stock_id)))
    except:
        real_stock_name = str(stock_id) # 萬一網路異常，至少顯示代號
        
    # ... (前面的 yfinance 抓真實名稱邏輯維持不變) ...
        
    # 同步把最新的真實價格更新進你的 SQLITE STOCK 資料庫
    latest_close = chart_data[-1]['close']
    conn = get_db()
    cursor = conn.cursor()
    
    # 🌟 關鍵升級：判斷是否為新標的。若存在則更新 (UPDATE)，若不存在則自動建檔 (INSERT)！
    cursor.execute("SELECT stock_id FROM STOCK WHERE stock_id = ?", (stock_id,))
    if cursor.fetchone():
        cursor.execute("UPDATE STOCK SET current_price = ? WHERE stock_id = ?", (latest_close, stock_id))
    else:
        cursor.execute("INSERT INTO STOCK (stock_id, stock_name, current_price) VALUES (?, ?, ?)", (stock_id, real_stock_name, latest_close))
        
    conn.commit()
    conn.close()

    # 👇 注意這裡：把剛抓到的 stock_name 一起打包傳給前端！
    return jsonify({
        "status": "success",
        "stock_id": stock_id,
        "stock_name": real_stock_name,
        "latest_signal": chart_data[-1]['signal'],
        "data": chart_data
    })

if __name__ == '__main__':
    app.run(debug=True)