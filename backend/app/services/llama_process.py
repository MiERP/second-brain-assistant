import asyncio
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import Settings


@dataclass(frozen=True)
class MachineInfo:
    cpu_cores: int
    cpu_threads: int
    ram_mb: int
    gpu_name: str
    gpu_vendor: str
    gpu_type: str
    gpu_vram_mb: int
    has_dgpu: bool


@dataclass(frozen=True)
class RuntimeProfile:
    backend: str
    chat_ctx_size: int
    embedding_ctx_size: int
    threads: int
    batch_size: int
    ubatch_size: int
    n_gpu_layers: int


class LlamaProcessManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.chat_proc: subprocess.Popen | None = None
        self.embed_proc: subprocess.Popen | None = None
        self._stopping = False

    async def ensure_started(self) -> None:
        chat_up, embed_up = await asyncio.gather(
            self.is_server_up("chat"),
            self.is_server_up("embedding"),
        )
        bin_path = self.find_llama_server_bin()
        if not bin_path:
            return
        if not chat_up:
            model = self.find_model("chat")
            if model:
                self.chat_proc = self._spawn("chat", bin_path, model)
        if not embed_up:
            model = self.find_model("embedding")
            if model:
                self.embed_proc = self._spawn("embedding", bin_path, model)

    async def stop(self) -> None:
        self._stopping = True
        for proc in (self.chat_proc, self.embed_proc):
            if proc and proc.poll() is None:
                proc.terminate()

    async def is_server_up(self, kind: str) -> bool:
        port = self.settings.llama_chat_port if kind == "chat" else self.settings.llama_embed_port
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                response = await client.get(f"http://{self.settings.llama_host}:{port}/v1/models")
                return response.is_success
        except Exception:
            return False

    def detect_machine_info(self) -> MachineInfo:
        if os.name == "nt":
            return self._detect_machine_info_windows()
        cores = os.cpu_count() or 4
        return MachineInfo(cores, cores, 0, "UNKNOWN", "Unknown", "Unknown", 0, False)

    def _detect_machine_info_windows(self) -> MachineInfo:
        script = (
            "$ErrorActionPreference='SilentlyContinue';"
            "$cs=Get-CimInstance Win32_ComputerSystem;"
            "$cpu=Get-CimInstance Win32_Processor|Select-Object -First 1;"
            "$ram=[math]::Round([double]$cs.TotalPhysicalMemory/1MB);"
            "$gpu=Get-CimInstance Win32_VideoController|Sort-Object AdapterRAM -Descending|Select-Object -First 1;"
            "$name=if($gpu){$gpu.Name}else{'NONE'};"
            "$vendor=if($name -match 'NVIDIA'){'NVIDIA'}elseif($name -match 'AMD|Radeon'){'AMD'}elseif($name -match 'Intel'){'Intel'}else{'Unknown'};"
            "$type=if($vendor -eq 'Intel'){'Onboard'}else{'Discrete'};"
            "$vram=if($gpu -and $gpu.AdapterRAM){[math]::Round([double]$gpu.AdapterRAM/1MB)}else{0};"
            "$dgpu=if($type -eq 'Discrete' -and $vendor -ne 'Intel'){1}else{0};"
            "Write-Output ($cpu.NumberOfCores.ToString()+'|'+$cpu.NumberOfLogicalProcessors.ToString()+'|'+$ram.ToString()+'|'+$name+'|'+$vendor+'|'+$type+'|'+$vram.ToString()+'|'+$dgpu.ToString())"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        parts = (result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "").split("|")

        def number(index: int, fallback: int) -> int:
            try:
                value = int(float(parts[index]))
                return value if value > 0 else fallback
            except Exception:
                return fallback

        cores = number(0, 4)
        return MachineInfo(
            cpu_cores=cores,
            cpu_threads=number(1, cores),
            ram_mb=number(2, 0),
            gpu_name=parts[3] if len(parts) > 3 else "NONE",
            gpu_vendor=parts[4] if len(parts) > 4 else "Unknown",
            gpu_type=parts[5] if len(parts) > 5 else "Unknown",
            gpu_vram_mb=number(6, 0),
            has_dgpu=(parts[7].strip() == "1") if len(parts) > 7 else False,
        )

    def find_llama_server_bin(self) -> Path | None:
        if self.settings.llama_server_bin and self.settings.llama_server_bin.exists():
            return self.settings.llama_server_bin
        root = self.find_auto_root()
        if not root:
            return None
        exe = "llama-server.exe" if os.name == "nt" else "llama-server"
        for candidate in self._server_candidates(root, exe):
            if candidate.exists():
                return candidate
        return None

    def find_model(self, kind: str) -> Path | None:
        model_name = self.settings.chat_model_name if kind == "chat" else self.settings.embed_model_name
        for root in self._candidate_roots():
            if not root:
                continue
            for model_dir in self._model_dirs(root):
                direct = model_dir / model_name
                if direct.exists():
                    return direct
        needles = ("bge", "e5", "embed") if kind == "embedding" else ("gemma", "llama", "qwen", "instruct")
        for root in self._candidate_roots():
            if not root:
                continue
            for model_dir in self._model_dirs(root):
                for path in model_dir.glob("*.gguf"):
                    if any(needle in path.name.lower() for needle in needles):
                        return path
        return None

    def find_auto_root(self) -> Path | None:
        exe = "llama-server.exe" if os.name == "nt" else "llama-server"
        for candidate in self._candidate_roots():
            if not candidate:
                continue
            if any(path.exists() for path in self._server_candidates(candidate, exe)):
                return candidate
        return None

    def _candidate_roots(self) -> list[Path | None]:
        return [
            self.settings.llama_auto_root,
            Path.cwd() / "resources",
            Path.cwd().parent / "resources",
        ]

    def _server_candidates(self, root: Path, exe: str) -> list[Path]:
        dirs = self._backend_candidates()
        return [root / directory / exe for directory in dirs]

    def _backend_candidates(self) -> list[str]:
        machine = self.detect_machine_info()
        dirs: list[str] = []
        if self.settings.llama_backend:
            dirs.append(self.settings.llama_backend)
        dirs.append("llama-bin")
        if machine.gpu_vendor == "NVIDIA":
            dirs.extend(["cuda-13.1-x64", "cuda-12.4-x64", "vulkan-x64"])
        elif machine.gpu_vendor == "AMD":
            dirs.append("vulkan-x64")
        dirs.append("cpu-x64")
        return list(dict.fromkeys(dirs))

    def _model_dirs(self, root: Path) -> list[Path]:
        candidates = [root / "models", root]
        return [path for path in candidates if path.exists()]

    def build_args(self, kind: str, model: Path) -> list[str]:
        runtime = self.compute_runtime_profile()
        port = self.settings.llama_chat_port if kind == "chat" else self.settings.llama_embed_port
        ctx = runtime.chat_ctx_size if kind == "chat" else runtime.embedding_ctx_size
        batch = self._effective_batch_size(kind, runtime)
        ubatch = self._effective_ubatch_size(kind, runtime)
        args = [
            "--host",
            self.settings.llama_host,
            "--port",
            str(port),
            "--model",
            str(model),
            "--ctx-size",
            str(ctx),
            "--threads",
            str(runtime.threads),
            "--batch-size",
            str(batch),
            "--ubatch-size",
            str(ubatch),
            "--flash-attn",
            "auto",
            "--no-warmup",
        ]
        if runtime.n_gpu_layers:
            args.extend(["--n-gpu-layers", str(runtime.n_gpu_layers)])
        if kind == "embedding":
            args.append("--embedding")
        else:
            args.extend(["--reasoning", "off"])
        return args

    def compute_runtime_profile(self) -> RuntimeProfile:
        machine = self.detect_machine_info()
        profile = (self.settings.llama_profile or "").lower()
        is_low = profile == "low" or (machine.ram_mb > 0 and machine.ram_mb <= 8192)
        is_mid = profile == "mid" or (not is_low and (machine.ram_mb == 0 or machine.ram_mb <= 16384))
        chat_ctx = 2048 if is_low else 4096 if is_mid else self.settings.chat_context_tokens
        threads = self.settings.llama_threads or max(2, min(8, machine.cpu_threads or 4))
        use_gpu = machine.gpu_vendor in {"NVIDIA", "AMD"} and machine.has_dgpu
        return RuntimeProfile(
            backend=self._selected_backend(),
            chat_ctx_size=chat_ctx,
            embedding_ctx_size=1024,
            threads=threads,
            batch_size=128 if is_low else 512,
            ubatch_size=64 if is_low else 256,
            n_gpu_layers=999 if use_gpu else 0,
        )

    def _selected_backend(self) -> str:
        exe = "llama-server.exe" if os.name == "nt" else "llama-server"
        root = self.find_auto_root()
        if not root:
            return self._backend_candidates()[0]
        for backend in self._backend_candidates():
            if (root / backend / exe).exists():
                return backend
        return self._backend_candidates()[0]

    def _effective_batch_size(self, kind: str, runtime: RuntimeProfile) -> int:
        configured = (
            self.settings.llama_embed_batch_size
            if kind == "embedding"
            else self.settings.llama_chat_batch_size
        )
        if configured and configured > 0:
            return configured
        return max(runtime.batch_size, 256) if kind == "embedding" else runtime.batch_size

    def _effective_ubatch_size(self, kind: str, runtime: RuntimeProfile) -> int:
        configured = (
            self.settings.llama_embed_ubatch_size
            if kind == "embedding"
            else self.settings.llama_chat_ubatch_size
        )
        if configured and configured > 0:
            return configured
        return max(runtime.ubatch_size, 256) if kind == "embedding" else runtime.ubatch_size

    def _spawn(self, kind: str, bin_path: Path, model: Path) -> subprocess.Popen:
        proc = subprocess.Popen(
            [str(bin_path), *self.build_args(kind, model)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        asyncio.create_task(self._watch(kind, proc, bin_path, model))
        return proc

    async def _watch(self, kind: str, proc: subprocess.Popen, bin_path: Path, model: Path) -> None:
        await asyncio.to_thread(proc.wait)
        if self._stopping:
            return
        await asyncio.sleep(3)
        restarted = self._spawn(kind, bin_path, model)
        if kind == "chat":
            self.chat_proc = restarted
        else:
            self.embed_proc = restarted
