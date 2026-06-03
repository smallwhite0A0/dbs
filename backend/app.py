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
# 升級版 ADSP：自適應卡爾曼濾波器 (AKF)
# ==========================================
def apply_adaptive_kalman_filter(prices, Q=0.5): # 🌟 將 Q 提高到 0.5，讓系統更願意相信趨勢改變
    if len(prices) == 0:
        return []
    
    # 計算滾動變異數作為動態 R 值
    rolling_var = prices.rolling(window=20).var().bfill()
    
    x_hat = prices.iloc[0] 
    P = 1.0                
    kalman_filtered = []
    
    for i in range(len(prices)):
        z = prices.iloc[i]
        if pd.isna(z):
            kalman_filtered.append(None)
            continue
            
        # 🌟 降低 R 的乘數為 0.1，避免在半導體高波動時過度平滑導致嚴重滯後
        R_dynamic = rolling_var.iloc[i] * 0.1 
        
        # 預測與更新
        x_hat_minus = x_hat
        P_minus = P + Q
        K = P_minus / (P_minus + R_dynamic) 
        x_hat = x_hat_minus + K * (z - x_hat_minus)
        P = (1 - K) * P_minus
        
        kalman_filtered.append(x_hat)
        
    return kalman_filtered

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
    
    # 🌟 關鍵修復：終極資料清洗 (Data Cleaning)
    # 1. 刪除完全沒有收盤價的無效幽靈資料
    df = df.dropna(subset=['Close']) 
    # 2. 如果中間有任何欄位缺失 (例如開高低)，用「前一筆有效價格」向後填補 (Forward Fill)
    df = df.ffill()
    
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
    
    # 3. 執行自適應卡爾曼濾波去噪價格
    df['Kalman_Price'] = apply_adaptive_kalman_filter(df['Close'])
    
    # 4. 計算 Z-Score 乖離率 (找尋超跌點)
    df['Residual'] = df['Close'] - df['Kalman_Price']
    rolling_std = df['Close'].rolling(window=20).std().bfill()
    df['Z_Score'] = df['Residual'] / rolling_std
    
    # 5. 買進策略邏輯
    trend_buy = (df['Close'] > df['Kalman_Price']) & (df['K'] > df['D'])
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
        # 直接把 STOCK 表裡面的代號、名稱、現價全部撈出來
        cursor.execute("SELECT stock_id, stock_name, current_price FROM STOCK")
        
        # 轉換成 JSON 格式的陣列
        stocks = [dict(row) for row in cursor.fetchall()]
        
        return jsonify({
            "status": "success", 
            "message": "大盤行情獲取成功",
            "data": stocks
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
            "kalman": round(float(row['Kalman_Price']), 2) if not pd.isna(row['Kalman_Price']) else None,
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
        
    # 同步把最新的真實價格更新進你的 SQLITE STOCK 資料庫
    latest_close = chart_data[-1]['close']
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE STOCK SET current_price = ? WHERE stock_id = ?", (latest_close, stock_id))
    conn.commit()
    conn.close()

    # 👇 注意這裡：把剛抓到的 stock_name 一起打包傳給前端！
    return jsonify({
        "status": "success",
        "stock_id": stock_id,
        "stock_name": real_stock_name, # 👈 新增這行：真實名稱
        "latest_signal": chart_data[-1]['signal'],
        "data": chart_data
    })

if __name__ == '__main__':
    app.run(debug=True)