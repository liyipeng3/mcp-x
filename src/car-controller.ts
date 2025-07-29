
interface CarControlResponse {
  success: boolean;
  message: string;
  data?: any;
}

type CarDirection = 'forward' | 'backward' | 'left' | 'right' | 'stop' | 'rotate_left' | 'rotate_right';

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

  constructor(baseUrl: string = 'http://192.168.1.106') {
    this.baseUrl = baseUrl;
  }

  private async makeRequest(endpoint: string, params: any = {}): Promise<CarControlResponse> {
    try {
      const url = new URL(endpoint, this.baseUrl);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, params[key].toString());
        }
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
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