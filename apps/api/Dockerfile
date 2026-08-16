FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONPATH=/app/src PATH=/app/.venv/bin:$PATH
WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates build-essential wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv "setuptools>=70" wheel

# The pinned Kociemba source uses legacy setup_requires/cffi metadata hooks.
# Install its build-time dependencies into the image first so the source build
# remains reproducible on Python 3.12 while retaining the exact upstream pin.
RUN pip install --no-cache-dir cffi pycparser pytest-runner future

RUN git clone --filter=blob:none https://github.com/fjh2002/fujiahao.git /tmp/kociemba \
    && cd /tmp/kociemba \
    && git checkout 64fd123bd9cc21d058b37a66473a2fe1807b6dad \
    && pip install --no-cache-dir --no-build-isolation . \
    && rm -rf /tmp/kociemba

RUN git clone --filter=blob:none https://github.com/dwalton76/rubiks-cube-NxNxN-solver.git /tmp/rubiks-cube-NxNxN-solver \
    && cd /tmp/rubiks-cube-NxNxN-solver \
    && git checkout c776db79314db3d98cc3dd99685ca85766656937 \
    && gcc -O3 -o /usr/local/bin/ida_search_via_graph \
        rubikscubennnsolver/ida_search_core.c \
        rubikscubennnsolver/rotate_xxx.c \
        rubikscubennnsolver/ida_search_666.c \
        rubikscubennnsolver/ida_search_777.c \
        rubikscubennnsolver/ida_search_via_graph.c -lm \
    && sed -i 's/setuptools==49.2.0/setuptools>=70/' pyproject.toml \
    && pip install --no-cache-dir --no-build-isolation . \
    && rm -rf /tmp/rubiks-cube-NxNxN-solver

COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv     && uv sync --frozen --no-dev

RUN uv pip install --python /app/.venv/bin/python --no-cache "setuptools>=70" wheel

RUN uv pip install --python /app/.venv/bin/python --no-cache cffi pycparser pytest-runner future

RUN git clone --filter=blob:none https://github.com/fjh2002/fujiahao.git /tmp/kociemba \
    && cd /tmp/kociemba \
    && git checkout 64fd123bd9cc21d058b37a66473a2fe1807b6dad \
    && uv pip install --python /app/.venv/bin/python --no-cache --no-build-isolation . \
    && rm -rf /tmp/kociemba

RUN git clone --filter=blob:none https://github.com/dwalton76/rubiks-cube-NxNxN-solver.git /tmp/rubiks-cube-NxNxN-solver \
    && cd /tmp/rubiks-cube-NxNxN-solver \
    && git checkout c776db79314db3d98cc3dd99685ca85766656937 \
    && sed -i 's/setuptools==49.2.0/setuptools>=70/' pyproject.toml \
    && uv pip install --python /app/.venv/bin/python --no-cache --no-build-isolation . \
    && rm -rf /tmp/rubiks-cube-NxNxN-solver
COPY src ./src

# The committed source files may carry restrictive modes (e.g. 0600). A plain
# `COPY src ./src` would preserve those modes, breaking the non-root runtime
# user with a PermissionError on import. Make /app/src world-readable (and
# give directories the execute bit so they can be traversed) while keeping the
# tree read-only for the nobody user.
RUN chmod -R a+rX /app/src
RUN test -x /usr/local/bin/ida_search_via_graph

RUN mkdir -p /app/lookup-tables && chown -R nobody:nogroup /app/lookup-tables

USER nobody
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "cube_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
