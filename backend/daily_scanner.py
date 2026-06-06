import sqlite3
import yfinance as yf
import pandas as pd
import numpy as np
import time
import logging

# 關閉 yfinance 煩人的報錯
logging.getLogger('yfinance').setLevel(logging.CRITICAL)

# 連結到與網頁共用的同一個資料庫
DATABASE = 'stock_market.db' 

# 🌟 台股熱門掃描池 (為了 Demo 順暢與安全，先以這 50 檔高流動性標的為主)
TARGET_STOCKS = {
    "2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2308": "台達電", "2382": "廣達",
    "2303": "聯電", "2881": "富邦金", "2891": "中信金", "2882": "國泰金", "2412": "中華電",
    "3231": "緯創", "2376": "技嘉", "3008": "大立光", "3711": "日月光", "2357": "華碩",
    "2324": "仁寶", "2353": "宏碁", "2356": "英業達", "2603": "長榮", "2609": "陽明",
    "2615": "萬海", "1519": "華城", "1514": "亞力", "2371": "大同", "2383": "台光電",
    "6239": "力成", "3034": "聯詠", "2379": "瑞昱", "3443": "創意", "3661": "世芯-KY",
    "3017": "奇鋐", "3324": "雙鴻", "8046": "南電", "3037": "欣興", "3189": "景碩",
    "2344": "華邦電", "2408": "南亞科", "2313": "華通", "6269": "台郡", "2368": "金像電",
    "2323": "中環", "2340": "光磊", "2349": "錸德", "2409": "友達", "3481": "群創",
    "5328": "華容", "5274": "信驊", "8299": "群聯", "6488": "環球晶", "8069": "元太"
}

# ==========================================
# 把 app.py 裡的 ADSP 大腦搬過來，讓它能獨立運作
# ==========================================
class StockKalmanFilter:
    def __init__(self, initial_price):
        self.x = np.array([[initial_price], [0.0]])
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
    N = 5
    prices = prices_series.values
    prices = pd.Series(prices).ffill().bfill().values 
    velocities = np.diff(prices, prepend=prices[0]) 
    
    kf_dynamic = StockKalmanFilter(initial_price=prices[0])
    kf_static = StockKalmanFilter(initial_price=prices[0])
    
    tvkf_filtered, tikf_filtered = [], []
    var_price_long = np.var(prices)
    var_vel_long = np.var(velocities)
    
    R_static = np.array([[var_price_long * 10.0]]) 
    Q_static = np.array([[var_vel_long * 0.1, 0], [0, var_vel_long * 0.1]])

    for i in range(len(prices)):
        z_k = np.array([[prices[i]]])
        if i < N:
            R_dynamic = np.array([[1e-2]])
            Q_dynamic = np.array([[1e-2, 0], [0, 1e-2]])
        else:
            var_price_short = np.var(prices[i-N:i])
            var_vel_short = np.var(velocities[i-N:i])
            R_dynamic = np.array([[max(var_price_short, 1e-4)]])
            Q_dynamic = np.array([[var_vel_short, 0], [0, var_vel_short]])

        kf_dynamic.predict(Q_dynamic)
        tvkf_filtered.append(kf_dynamic.update(z_k, R_dynamic))
        kf_static.predict(Q_static)
        tikf_filtered.append(kf_static.update(z_k, R_static))
        
    return pd.DataFrame({'TVKF': tvkf_filtered, 'TIKF': tikf_filtered}, index=prices_series.index)

def calculate_indicators(df):
    # KD 計算
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
    
    # 卡爾曼與 Z-Score
    kf_results = run_kalman_strategies(df['Close'])
    df['TVKF'] = kf_results['TVKF']
    df['TIKF'] = kf_results['TIKF']
    
    df['Residual'] = df['Close'] - df['TVKF']
    rolling_std = df['Close'].rolling(window=20).std().bfill()
    df['Z_Score'] = df['Residual'] / rolling_std
    
    return df

# ==========================================
# 主執行迴圈
# ==========================================
def run_daily_scan():
    print("🚀 [啟動] ADSP 量化選股雷達背景掃描中...")
    
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # 🌟 這裡就是自動建立資料表的完美位置！
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS SCREENER_SIGNALS (
            stock_id TEXT PRIMARY KEY,
            stock_name TEXT,
            close_price REAL,
            signal TEXT,
            color TEXT,
            update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 每次掃描前，先清空昨天的舊訊號
    cursor.execute('DELETE FROM SCREENER_SIGNALS')
    
    found_count = 0
    total = len(TARGET_STOCKS)
    current = 0

    for sid, sname in TARGET_STOCKS.items():
        current += 1
        print(f"⏳ 掃描進度 ({current}/{total}): {sname} ({sid})...", end="\r")
        
        try:
            # 依序嘗試上市與上櫃
            df = yf.download(f"{sid}.TW", period="1y", interval="1d", progress=False)
            if df.empty:
                df = yf.download(f"{sid}.TWO", period="1y", interval="1d", progress=False)
            
            if df.empty or len(df) < 60: continue

            # 執行量化運算
            df = calculate_indicators(df)
            
            # 取出最後兩筆資料比對
            curr = df.iloc[-1]
            prev = df.iloc[-2]

            if pd.isna(curr['TVKF']) or pd.isna(curr['TIKF']) or pd.isna(curr['K']):
                continue

            close = float(curr['Close'])
            tvkf = float(curr['TVKF'])
            tikf = float(curr['TIKF'])
            k_val = float(curr['K'])
            z_score = float(curr['Z_Score'])
            prev_tvkf = float(prev['TVKF'])
            prev_tikf = float(prev['TIKF'])

            signal_type = None
            color = ""

            # 🤖 量化大腦：策略判定
            if z_score < -2.0:
                signal_type = "🚨 策略二：極端超跌抄底"
                color = "#8b5cf6"
            elif prev_tvkf <= prev_tikf and tvkf > tikf:
                if k_val >= 80 or z_score >= 1.5:
                    signal_type = "🚀⚠️ 黃金交叉但過熱 (建議觀望)"
                    color = "#f59e0b"
                else:
                    signal_type = "🚀 策略一：雙線黃金交叉"
                    color = "#f97316"
            elif close > tvkf and tvkf > tikf:
                if k_val < 80 and z_score < 1.5:
                    signal_type = "🎯 策略三：趨勢共振"
                    color = "#ef4444"

            # 如果觸發策略，寫入資料庫！
            if signal_type:
                cursor.execute('''
                    INSERT INTO SCREENER_SIGNALS (stock_id, stock_name, close_price, signal, color)
                    VALUES (?, ?, ?, ?, ?)
                ''', (sid, sname, close, signal_type, color))
                found_count += 1
                
        except Exception as e:
            pass
            
        time.sleep(0.2) # 防封鎖延遲

    conn.commit()
    conn.close()
    print(f"\n✅ 掃描完成！共發現 {found_count} 檔觸發策略標的，已寫入資料庫。")

if __name__ == "__main__":
    run_daily_scan()