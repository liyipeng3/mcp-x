
export interface CarControlResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export type CarDirection =
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "stop"
  | "rotate_left"
  | "rotate_right";

interface MoveCarParams {
  cmd: CarDirection;
  speed?: number;
  duration?: number;
}

interface SetSpeedParams {
  speed: number;
}

interface PilotCarParams {
  route: { direction: CarDirection, speed?: number, duration?: number }[];
}

export class CarController {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.CAR_BASE_URL ?? "http://192.168.1.106") {
    this.baseUrl = baseUrl;
  }

  setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  private async makeRequest(endpoint: string, params: Record<string, unknown> = {}): Promise<CarControlResponse> {
    try {
      const url = new URL(endpoint, this.baseUrl);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, String(params[key]));
        }
      });

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const data = isJson ? await response.json().catch(() => null) : await response.text().catch(() => "");

      if (data && typeof data === "object" && "status" in data) {
        const status = (data as any).status;
        const speed = (data as any).speed;
        const messageParts = [
          typeof status === "string" ? status : "ok",
          typeof speed === "number" ? `speed=${speed}` : undefined,
        ].filter(Boolean);
        return { success: true, message: messageParts.join(" "), data };
      }

      if (data && typeof data === "object" && "message" in data) {
        const message = (data as any).message;
        return { success: true, message: typeof message === "string" ? message : "ok", data };
      }

      return { success: true, message: "ok", data };
    } catch (error) {
      throw new Error(`Car control request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async moveCar(params: MoveCarParams): Promise<CarControlResponse> {
    const { cmd, speed, duration } = params;
    if (speed) {
      await this.setSpeed({ speed });
    }
    const res = await this.makeRequest('/api', {
      cmd: cmd,
    });
    if (duration) {
      await new Promise(resolve => setTimeout(resolve, duration * 1000));
      await this.stopCar();
    }
    return res;
  }

  async setSpeed(params: SetSpeedParams): Promise<CarControlResponse> {
    return this.makeRequest('/api', {
      cmd: 'speed_' + params.speed,
    });
  }

  async pilotCar(params: PilotCarParams): Promise<CarControlResponse> {
    const { route } = params;
    for (const { direction, speed, duration } of route) {
      await this.moveCar({ cmd: direction, speed, duration });
    }
    return { success: true, message: 'Car pilot command executed' };
  }

  async stopCar(): Promise<CarControlResponse> {
    return this.makeRequest('/api', {
      cmd: 'stop',
    });
  }
}
