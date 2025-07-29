import z from "zod";
import { CarController } from "./car-controller";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";


const carController = new CarController();

export const registerTools = (server: McpServer) => {



    // 注册工具
    server.registerTool('move_car', {
        description: 'Move the car in a specified direction with optional speed and duration, car control parameters: Speed 125, rotate 2.5s = 180°, rotate 5s = 360°',
        inputSchema: {
            direction: z.enum(['forward', 'backward', 'left', 'right', 'stop', 'rotate_left', 'rotate_right']).describe("Direction to move the car"),
            speed: z.number().min(100).max(255).optional().describe("Speed of movement (100-255)"),
            duration: z.number().min(0).optional().describe("Duration of movement in seconds")
        }
    }, async ({ direction, speed, duration }: { direction?: 'forward' | 'backward' | 'left' | 'right' | 'stop', speed?: number, duration?: number }) => ({
        content: [{
            type: "text",
            text: `Car movement command executed. Direction: ${direction}, Speed: ${speed || 'default'}, Duration: ${duration || 'continuous'}. Result: ${(await carController.moveCar({ cmd: direction, speed, duration })).message}`
        }]
    }));

    server.registerTool('set_car_speed', {
        description: 'Set the speed of the car',
        inputSchema: {
            speed: z.number().min(100).max(255).describe("Speed to set (100-255)")
        }
    }, async ({ speed }: { speed: number }) => ({
        content: [{
            type: "text",
            text: `Car speed set to ${speed}. Result: ${(await carController.setSpeed({ speed })).message}`
        }]
    }));

    server.registerTool('pilot_car', {
        description: 'Pilot the car, car control parameters: Speed 125, rotate 2.5s = 180°, rotate 5s = 360°',
        inputSchema: {
            route: z.array(z.object({
                direction: z.enum(['forward', 'backward', 'left', 'right', 'stop', 'rotate_left', 'rotate_right']).describe("Direction to move the car"),
                speed: z.number().min(100).max(255).optional().describe("Speed of movement (100-255)"),
                duration: z.number().min(0).optional().describe("Duration of movement in seconds")
            })).describe("Route to pilot the car")
        }
    }, async ({ route }: { route: { direction: 'forward' | 'backward' | 'left' | 'right' | 'stop', speed?: number, duration?: number }[] }) => ({
        content: [{
            type: "text",
            text: `Car pilot command executed. Route: ${route.map(r => `${r.direction}, Speed: ${r.speed || 'default'}, Duration: ${r.duration || 'continuous'}`).join(', ')}. Result: ${(await carController.pilotCar({route})).message}`
        }]
    }));

    server.registerTool('stop_car', {
        description: 'Stop the car',
        inputSchema: {
            duration: z.number().min(0).optional().describe("Duration of stop in seconds")
        }
    }, async ({ duration }: { duration?: number }) => ({
        content: [{
            type: "text",
            text: `Car stop command executed. Duration: ${duration || 'continuous'}. Result: ${(await carController.stopCar()).message}`
        }]
    }));


}
