"""DAG runtime (roadmap §2.2, §3.2).

A :class:`Graph` is a set of :class:`Node` objects linked by named edges. Nodes
declare their input/output artifact contract and a ``config_repr`` used for cache
keying. Execution is topological; results are memoised through the
:class:`~neiro.engine.cache.ArtifactCache` so re-runs recompute only what changed.

Progress is reported through a callback so a UI (or the CLI) can show real stage
names instead of a fake percentage. Cancellation is cooperative: a node checks
``ctx.cancelled`` at chunk boundaries.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from neiro.engine.artifacts import Artifact
from neiro.engine.cache import ArtifactCache, cache_key

__all__ = ["Node", "Graph", "NodeResult", "ExecutionContext"]

ProgressFn = Callable[["Progress"], None]


@dataclass
class Progress:
    node_id: str
    stage: str
    fraction: float
    message: str = ""


@dataclass
class ExecutionContext:
    cache: ArtifactCache
    progress: ProgressFn | None = None
    cancelled_flag: dict[str, bool] = field(default_factory=lambda: {"v": False})
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def cancelled(self) -> bool:
        return self.cancelled_flag["v"]

    def cancel(self) -> None:
        self.cancelled_flag["v"] = True

    def report(self, node_id: str, stage: str, fraction: float, message: str = "") -> None:
        if self.progress is not None:
            self.progress(Progress(node_id, stage, max(0.0, min(1.0, fraction)), message))


@dataclass
class NodeResult:
    outputs: dict[str, Artifact]
    elapsed_seconds: float
    from_cache: bool


class Node:
    """Base class for all processing nodes.

    Subclasses set ``node_id`` and implement :meth:`run`. ``inputs`` maps this
    node's input port names to ``(upstream_node_id, upstream_port)`` tuples.
    """

    node_id: str = "node"

    def __init__(self, node_id: str | None = None, inputs: dict[str, tuple[str, str]] | None = None):
        if node_id is not None:
            self.node_id = node_id
        self.inputs: dict[str, tuple[str, str]] = inputs or {}

    def config_repr(self) -> str:
        """Stable string describing this node's configuration, for cache keying."""
        return self.__class__.__name__

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        raise NotImplementedError


class CancelledError(RuntimeError):
    pass


class Graph:
    def __init__(self) -> None:
        self._nodes: dict[str, Node] = {}

    def add(self, node: Node) -> Node:
        if node.node_id in self._nodes:
            raise ValueError(f"duplicate node id: {node.node_id}")
        self._nodes[node.node_id] = node
        return node

    def __contains__(self, node_id: str) -> bool:
        return node_id in self._nodes

    @property
    def nodes(self) -> Iterable[Node]:
        return self._nodes.values()

    def topological_order(self) -> list[Node]:
        indeg: dict[str, int] = {nid: 0 for nid in self._nodes}
        deps: dict[str, set[str]] = {nid: set() for nid in self._nodes}
        for nid, node in self._nodes.items():
            for _, (up, _port) in node.inputs.items():
                if up not in self._nodes:
                    raise ValueError(f"node {nid!r} depends on unknown node {up!r}")
                deps[nid].add(up)
        for nid, ds in deps.items():
            indeg[nid] = len(ds)

        ready = [nid for nid, d in indeg.items() if d == 0]
        order: list[str] = []
        while ready:
            ready.sort()  # deterministic
            nid = ready.pop(0)
            order.append(nid)
            for other, ds in deps.items():
                if nid in ds:
                    ds.discard(nid)
                    indeg[other] -= 1
                    if indeg[other] == 0:
                        ready.append(other)
        if len(order) != len(self._nodes):
            raise ValueError("graph contains a cycle")
        return [self._nodes[nid] for nid in order]

    def execute(self, ctx: ExecutionContext, targets: list[str] | None = None) -> dict[str, dict[str, Artifact]]:
        """Run the graph, returning ``{node_id: {port: artifact}}``.

        If ``targets`` is given, only those nodes and their transitive
        dependencies are executed.
        """
        order = self.topological_order()
        if targets is not None:
            needed = self._ancestors(targets)
            order = [n for n in order if n.node_id in needed]

        results: dict[str, dict[str, Artifact]] = {}
        key_by_node: dict[str, str] = {}

        for node in order:
            if ctx.cancelled:
                raise CancelledError(f"cancelled before {node.node_id}")

            resolved: dict[str, Artifact] = {}
            input_keys: list[str] = []
            for port, (up, up_port) in node.inputs.items():
                art = results[up][up_port]
                resolved[port] = art
                input_keys.append(art.content_key())

            key = cache_key(node.node_id, node.config_repr(), input_keys)
            key_by_node[node.node_id] = key

            hit_before = ctx.cache.hits
            start = time.perf_counter()

            def _compute(node=node, resolved=resolved) -> dict[str, Artifact]:
                return node.run(ctx, resolved)

            outputs = ctx.cache.get_or_compute(key, _compute)
            elapsed = time.perf_counter() - start
            from_cache = ctx.cache.hits > hit_before
            results[node.node_id] = outputs
            ctx.report(
                node.node_id,
                "done",
                1.0,
                f"{'cached' if from_cache else 'computed'} in {elapsed*1000:.0f} ms",
            )

        return results

    def _ancestors(self, targets: list[str]) -> set[str]:
        seen: set[str] = set()
        stack = list(targets)
        while stack:
            nid = stack.pop()
            if nid in seen:
                continue
            seen.add(nid)
            node = self._nodes.get(nid)
            if node is None:
                raise ValueError(f"unknown target node {nid!r}")
            for _, (up, _p) in node.inputs.items():
                stack.append(up)
        return seen
