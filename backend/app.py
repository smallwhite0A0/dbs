import sqlite3
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

# 6. 查詢庫存 API (不需新增 Table，直接動態計算)
@app.route('/api/inventory', methods=['POST'])
def inventory():
    email = request.json['email']
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 使用 JOIN 結合交易表與股票表，並用 GROUP BY 計算每支股票的結餘
        cursor.execute("""
            SELECT 
                t.stock_id, 
                s.stock_name, 
                s.current_price,
                SUM(CASE WHEN t.action = 'buy' THEN t.quantity 
                         WHEN t.action = 'sell' THEN -t.quantity 
                         ELSE 0 END) as total_quantity
            FROM Transaction_History t
            JOIN STOCK s ON t.stock_id = s.stock_id
            WHERE t.email = ?
            GROUP BY t.stock_id
            HAVING total_quantity > 0
        """, (email,))
        
        # 抓取所有計算結果
        records = [dict(row) for row in cursor.fetchall()]
        
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

@app.route('/test_db', methods=['GET'])
def test_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM User")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"status": "success", "data": users})

if __name__ == '__main__':
    app.run(debug=True)