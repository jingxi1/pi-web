declare module "node-pty" {
  export interface IPty {
    pid: number;
    cols: number;
    rows: number;
    process: string;
    onData: (listener: (data: string) => void) => { dispose: () => void };
    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
  }

  export function spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
      encoding?: string | null;
      handleFlowControl?: boolean;
      useConpty?: boolean;
    },
  ): IPty;
}