/*
  ESP32 Car Controller
  硬件：ESP32 + 2x TB6612FNG + 4个直流电机
*/

#include <WiFi.h>

#include <TFT_eSPI.h>  // Hardware-specific library

TFT_eSPI tft = TFT_eSPI();  // Invoke custom library

// WiFi配置
const char* ssid = "WIFI-S";
const char* password = "lyp15770008102";

#define TFT_FONT_HEIGHT 32  // 基础字体高度
#define TFT_LINE_SPACING 4  // 行间距

// Web服务器
WiFiServer server(80);

// 电机引脚定义 - 左右分组
// TB6612FNG #1 - 左侧电机控制
const int LEFT_FRONT_AIN1 = 10;
const int LEFT_FRONT_AIN2 = 11;
const int LEFT_FRONT_PWM = 12;
const int LEFT_REAR_BIN1 = 46;
const int LEFT_REAR_BIN2 = 7;
const int LEFT_REAR_PWM = 6;
const int LEFT_STBY = 9;

// TB6612FNG #2 - 右侧电机控制
const int RIGHT_FRONT_AIN1 = 18;
const int RIGHT_FRONT_AIN2 = 48;
const int RIGHT_FRONT_PWM = 14;
const int RIGHT_REAR_BIN1 = 16;
const int RIGHT_REAR_BIN2 = 15;
const int RIGHT_REAR_PWM = 2;
const int RIGHT_STBY = 17;

// PWM设置
const int PWM_FREQ = 1000;
const int PWM_RESOLUTION = 8;

// 电机方向定义
enum MotorDirection {
  STOP = 0,
  FORWARD = 1,
  BACKWARD = 2,
  BRAKE = 3
};

// 电机ID定义
enum MotorID {
  LEFT_FRONT = 0,
  LEFT_REAR = 1,
  RIGHT_FRONT = 2,
  RIGHT_REAR = 3
};

// 全局变量
int currentSpeed = 150;
bool motorsEnabled = true;
String currentStatus = "Stopped";

// 新增网页内容常量
const char MAIN_page[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html><head>
<title>ESP32 Car</title>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  color: white;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  user-select: none;
  -webkit-user-select: none;
}
h1 {
  font-size: 2.5em;
  margin-bottom: 20px;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
  text-align: center;
}
.container {
  width: 100%;
  max-width: 400px;
}
.status-bar {
  background: rgba(255,255,255,0.1);
  border-radius: 15px;
  padding: 15px;
  margin-bottom: 20px;
  text-align: center;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
}
.status-bar.active {
  background: rgba(76,175,80,0.3);
  box-shadow: 0 0 20px rgba(76,175,80,0.5);
}
.speed-control {
  background: rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 30px;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.speed-display {
  text-align: center;
  font-size: 1.5em;
  margin-bottom: 15px;
  font-weight: 500;
}
.speed-value {
  color: #4CAF50;
  font-weight: bold;
  font-size: 1.2em;
}
.speed-buttons {
  display: flex;
  justify-content: center;
  gap: 20px;
}
.btn {
  width: 80px;
  height: 80px;
  border: none;
  border-radius: 50%;
  font-size: 30px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.btn:active {
  transform: scale(0.95);
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
}
.btn-speed {
  background: linear-gradient(145deg, #ff6b6b, #ee5a5a);
  color: white;
  width: 60px;
  height: 60px;
}
.control-pad {
  background: rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 30px;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.control-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  max-width: 300px;
  margin: 0 auto;
}
.btn-move {
  background: linear-gradient(145deg, #4CAF50, #45a049);
  color: white;
}
.btn-rotate {
  background: linear-gradient(145deg, #2196F3, #1976D2);
  color: white;
}
.btn-stop {
  background: linear-gradient(145deg, #f44336, #d32f2f);
  color: white;
  font-size: 20px;
}
.empty { visibility: hidden; }
.icon {
  font-size: 40px;
  line-height: 1;
}
.loading {
  display: none;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.8);
  padding: 20px;
  border-radius: 10px;
  z-index: 1000;
}
</style>
</head><body>
<div class='container'>
<div class='status-bar' id='statusBar'>
<div id='statusText'>Ready to Drive! 🚗</div>
</div>
<div class='speed-control'>
<div class='speed-display'>Speed: <span class='speed-value' id='speedValue'>%SPEED%</span></div>
<div class='speed-buttons'>
<button class='btn btn-speed' onclick='adjustSpeed(-20)'>−</button>
<button class='btn btn-speed' onclick='adjustSpeed(20)'>+</button>
</div>
</div>
<div class='control-pad'>
<div class='control-grid'>
<button class='btn btn-rotate' onpointerdown='sendCommand("rotate_left")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>↺</span></button>
<button class='btn btn-move' onpointerdown='sendCommand("forward")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>↑</span></button>
<button class='btn btn-rotate' onpointerdown='sendCommand("rotate_right")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>↻</span></button>
<button class='btn btn-move' onpointerdown='sendCommand("left")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>←</span></button>
<button class='btn btn-stop' onclick='sendCommand("stop")'>STOP</button>
<button class='btn btn-move' onpointerdown='sendCommand("right")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>→</span></button>
<div class='empty'></div>
<button class='btn btn-move' onpointerdown='sendCommand("backward")' onpointerup='sendCommand("stop")' onpointercancel='sendCommand("stop")' ><span class='icon'>↓</span></button>
<div class='empty'></div>
</div>
</div>
</div>
<div class='loading' id='loading'>Sending...</div>
<script>
let currentSpeed = %SPEED%;
let abortController = null;
async function sendCommand(cmd) {
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const response = await fetch('/api?cmd=' + cmd, {
      signal: abortController.signal,
      method: 'GET'
    });
    
    if (response.ok) {
      const data = await response.json();
      updateStatus(data);
    } else {
      console.error('Request failed with status:', response.status);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Request was aborted');
    } else {
      console.error('Network error:', error);
    }
  } finally {
    abortController = null;
  }

}
function adjustSpeed(delta) {
  const newSpeed = Math.max(50, Math.min(255, currentSpeed + delta));
  sendCommand('speed_' + newSpeed);
}
function updateStatus(data) {
  if (data.speed !== undefined) {
    currentSpeed = data.speed;
    document.getElementById('speedValue').textContent = currentSpeed;
  }
  if (data.status !== undefined) {
    document.getElementById('statusText').textContent = data.status;
    const statusBar = document.getElementById('statusBar');
    if (data.status !== 'Stopped') {
      statusBar.classList.add('active');
    } else {
      statusBar.classList.remove('active');
    }
  }
}
document.addEventListener('touchmove', function(e) {
  e.preventDefault();
}, { passive: false });
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
});
</script>
</body></html> 
)rawliteral";

void setup() {
  Serial0.begin(115200);
  Serial0.println("ESP32 4WD Car Controller (AJAX) Starting...");

  tft.init();
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.setRotation(1);
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(0, 0);
  tft.println("Starting...");

  setupMotorPins();
  setupPWM();
  enableDrivers();
  setupWiFi();
  server.begin();

  Serial0.println("System Ready!");
  printHelp();

  showStatusOnTFT();
}

void setupMotorPins() {
  pinMode(LEFT_FRONT_AIN1, OUTPUT);
  pinMode(LEFT_FRONT_AIN2, OUTPUT);
  pinMode(LEFT_REAR_BIN1, OUTPUT);
  pinMode(LEFT_REAR_BIN2, OUTPUT);
  pinMode(LEFT_STBY, OUTPUT);

  pinMode(RIGHT_FRONT_AIN1, OUTPUT);
  pinMode(RIGHT_FRONT_AIN2, OUTPUT);
  pinMode(RIGHT_REAR_BIN1, OUTPUT);
  pinMode(RIGHT_REAR_BIN2, OUTPUT);
  pinMode(RIGHT_STBY, OUTPUT);

  stopAllMotors();
}

void setupPWM() {
  ledcAttach(LEFT_FRONT_PWM, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(LEFT_REAR_PWM, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(RIGHT_FRONT_PWM, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(RIGHT_REAR_PWM, PWM_FREQ, PWM_RESOLUTION);
}

void enableDrivers() {
  digitalWrite(LEFT_STBY, HIGH);
  digitalWrite(RIGHT_STBY, HIGH);
}

void setupWiFi() {

  WiFi.begin(ssid, password);
  Serial0.print("Connecting to WiFi");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial0.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial0.println();
    Serial0.print("WiFi connected! IP address: ");
    Serial0.println(WiFi.localIP());
    Serial0.println("Open browser and go to: http://" + WiFi.localIP().toString());
  } else {
    Serial0.println();
    Serial0.println("WiFi connection failed. Operating in Serial mode only.");
  }
}

void setMotor(MotorID motorId, MotorDirection direction, int speed) {
  if (!motorsEnabled) return;

  speed = constrain(speed, 0, 255);

  int ain1, ain2, pwmPin;

  switch (motorId) {
    case LEFT_FRONT:
      ain1 = LEFT_FRONT_AIN1;
      ain2 = LEFT_FRONT_AIN2;
      pwmPin = LEFT_FRONT_PWM;
      break;
    case LEFT_REAR:
      ain1 = LEFT_REAR_BIN1;
      ain2 = LEFT_REAR_BIN2;
      pwmPin = LEFT_REAR_PWM;
      break;
    case RIGHT_FRONT:
      ain1 = RIGHT_FRONT_AIN1;
      ain2 = RIGHT_FRONT_AIN2;
      pwmPin = RIGHT_FRONT_PWM;
      break;
    case RIGHT_REAR:
      ain1 = RIGHT_REAR_BIN1;
      ain2 = RIGHT_REAR_BIN2;
      pwmPin = RIGHT_REAR_PWM;
      break;
    default:
      return;
  }

  switch (direction) {
    case FORWARD:
      digitalWrite(ain1, LOW);
      digitalWrite(ain2, HIGH);
      ledcWrite(pwmPin, speed);
      break;
    case BACKWARD:
      digitalWrite(ain1, HIGH);
      digitalWrite(ain2, LOW);
      ledcWrite(pwmPin, speed);
      break;
    case BRAKE:
      digitalWrite(ain1, HIGH);
      digitalWrite(ain2, HIGH);
      ledcWrite(pwmPin, 255);
      break;
    case STOP:
    default:
      digitalWrite(ain1, LOW);
      digitalWrite(ain2, LOW);
      ledcWrite(pwmPin, 0);
      break;
  }
}

void setLeftSide(MotorDirection direction, int speed) {
  setMotor(LEFT_FRONT, direction, speed);
  setMotor(LEFT_REAR, direction, speed);
}

void setRightSide(MotorDirection direction, int speed) {
  setMotor(RIGHT_FRONT, direction, speed);
  setMotor(RIGHT_REAR, direction, speed);
}

void moveForward(int speed) {
  currentStatus = "Moving Forward";
  Serial0.println(currentStatus);
  setLeftSide(FORWARD, speed);
  setRightSide(FORWARD, speed);
  showStatusOnTFT();
}

void moveBackward(int speed) {
  currentStatus = "Moving Backward";
  Serial0.println(currentStatus);
  setLeftSide(BACKWARD, speed);
  setRightSide(BACKWARD, speed);
  showStatusOnTFT();
}

void turnLeft(int speed) {
  currentStatus = "Turning Left";
  Serial0.println(currentStatus);
  setLeftSide(FORWARD, speed / 2);
  setRightSide(FORWARD, speed);
  showStatusOnTFT();
}

void turnRight(int speed) {
  currentStatus = "Turning Right";
  Serial0.println(currentStatus);
  setLeftSide(FORWARD, speed);
  setRightSide(FORWARD, speed / 2);
  showStatusOnTFT();
}

void rotateLeft(int speed) {
  currentStatus = "Rotating Left";
  Serial0.println(currentStatus);
  setLeftSide(BACKWARD, speed);
  setRightSide(FORWARD, speed);
  showStatusOnTFT();
}

void rotateRight(int speed) {
  currentStatus = "Rotating Right";
  Serial0.println(currentStatus);
  setLeftSide(FORWARD, speed);
  setRightSide(BACKWARD, speed);
  showStatusOnTFT();
}

void stopAllMotors() {
  currentStatus = "Stopped";
  Serial0.println(currentStatus);
  setLeftSide(STOP, 0);
  setRightSide(STOP, 0);
  showStatusOnTFT();
}

// 发送主页面
// 替换原来的 sendMainPage 函数
void sendMainPage(WiFiClient client) {
  // 发送响应头
  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:text/html");
  client.println("Connection: close");
  client.println();
  
  // 分块发送HTML内容
  const char* html_ptr = MAIN_page;
  size_t html_len = strlen_P(MAIN_page);
  
  // 创建一个缓冲区用于替换速度值
  const size_t chunk_size = 1024;
  char buffer[chunk_size + 1];
  
  size_t sent = 0;
  while (sent < html_len) {
    // 计算本次要发送的字节数
    size_t to_send = min(chunk_size, html_len - sent);
    
    // 从PROGMEM复制到缓冲区
    memcpy_P(buffer, html_ptr + sent, to_send);
    buffer[to_send] = '\0';
    
    // 检查是否包含需要替换的占位符
    String chunk = String(buffer);
    if (chunk.indexOf("%SPEED%") >= 0) {
      chunk.replace("%SPEED%", String(currentSpeed));
    }
    
    // 发送数据块
    client.print(chunk);
    
    sent += to_send;
  }
  
  // 确保所有数据都发送完成
  client.flush();
}

// 发送API响应
void sendAPIResponse(WiFiClient client, String command) {
  // 处理命令
  if (command == "forward") {
    moveForward(currentSpeed);
  } else if (command == "backward") {
    moveBackward(currentSpeed);
  } else if (command == "left") {
    turnLeft(currentSpeed);
  } else if (command == "right") {
    turnRight(currentSpeed);
  } else if (command == "rotate_left") {
    rotateLeft(currentSpeed);
  } else if (command == "rotate_right") {
    rotateRight(currentSpeed);
  } else if (command == "stop") {
    stopAllMotors();
  } else if (command.startsWith("speed_")) {
    int newSpeed = command.substring(6).toInt();
    currentSpeed = constrain(newSpeed, 50, 255);
    Serial0.println("Speed: " + String(currentSpeed));
    showStatusOnTFT();
  }

  // 发送JSON响应
  client.println("HTTP/1.1 200 OK");
  client.println("Content-type:application/json");
  client.println("Connection: close");
  client.println();

  client.print("{");
  client.print("\"status\":\"" + currentStatus + "\",");
  client.print("\"speed\":" + String(currentSpeed));
  client.println("}");
}

// Web服务器处理
void handleWebClient() {
  WiFiClient client = server.available();
  if (client) {
    String currentLine = "";
    String requestLine = "";

    while (client.connected()) {
      if (client.available()) {
        char c = client.read();

        if (c == '\n') {
          if (currentLine.length() == 0) {
            // 解析请求
            if (requestLine.indexOf("GET /api?cmd=") >= 0) {
              // API请求
              int cmdStart = requestLine.indexOf("cmd=") + 4;
              int cmdEnd = requestLine.indexOf(' ', cmdStart);
              String command = requestLine.substring(cmdStart, cmdEnd);
              sendAPIResponse(client, command);
            } else {
              // 主页请求
              sendMainPage(client);
            }
            break;
          } else {
            if (requestLine == "") {
              requestLine = currentLine;
            }
            currentLine = "";
          }
        } else if (c != '\r') {
          currentLine += c;
        }
      }
    }

    client.stop();
  }
}

// 串口命令处理
void handleSerialCommands() {
  if (Serial0.available()) {
    char cmd = Serial0.read();

    switch (cmd) {
      case 'w':
      case 'W':
        moveForward(currentSpeed);
        break;
      case 's':
      case 'S':
        moveBackward(currentSpeed);
        break;
      case 'a':
      case 'A':
        turnLeft(currentSpeed);
        break;
      case 'd':
      case 'D':
        turnRight(currentSpeed);
        break;
      case 'q':
      case 'Q':
        rotateLeft(currentSpeed);
        break;
      case 'e':
      case 'E':
        rotateRight(currentSpeed);
        break;
      case 'x':
      case 'X':
        stopAllMotors();
        break;
      case '+':
        currentSpeed = min(255, currentSpeed + 20);
        Serial0.printf("Speed: %d\n", currentSpeed);
        showStatusOnTFT();
        break;
      case '-':
        currentSpeed = max(50, currentSpeed - 20);
        Serial0.printf("Speed: %d\n", currentSpeed);
        showStatusOnTFT();
        break;
      case 'h':
      case 'H':
        printHelp();
        break;
    }
  }
}

void printHelp() {
  Serial0.println("\n=== ESP32 Car Controller Commands ===");
  Serial0.println("w/W - Move Forward");
  Serial0.println("s/S - Move Backward");
  Serial0.println("a/A - Turn Left");
  Serial0.println("d/D - Turn Right");
  Serial0.println("q/Q - Rotate Left (in place)");
  Serial0.println("e/E - Rotate Right (in place)");
  Serial0.println("x/X - Stop All Motors");
  Serial0.println("+   - Increase Speed");
  Serial0.println("-   - Decrease Speed");
  Serial0.println("h/H - Show Help");
  Serial0.printf("Current Speed: %d\n", currentSpeed);
  Serial0.println("=====================================\n");
}

void showStatusOnTFT() {
  // 清屏
  tft.fillScreen(TFT_BLACK);

  // 设置标题
  tft.setTextSize(3);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.drawString("ESP32 Car", 10, 10);

  // 显示状态信息
  tft.setTextSize(2);
  if (currentStatus == "Stopped") {
    tft.setTextColor(TFT_RED, TFT_BLACK);
  } else {
    tft.setTextColor(TFT_GREEN, TFT_BLACK);
  }
  String statusMsg = currentStatus;
  tft.drawString(statusMsg, 10, 90);


  tft.setTextColor(TFT_BLUE, TFT_BLACK);

  // 显示速度信息
  String speedMsg = "Speed: " + String(currentSpeed);
  tft.drawString(speedMsg, 10, 150);

  // 显示WiFi和IP信息
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  if (WiFi.status() == WL_CONNECTED) {
    String ipMsg = "IP: " + WiFi.localIP().toString();
    tft.drawString(ipMsg, 10, 210);
  } else {
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.drawString("WiFi: Not Connected", 10, 210);
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    handleWebClient();
  }

  handleSerialCommands();
}