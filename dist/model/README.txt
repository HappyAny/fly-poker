Model and data sources

The full browser graph is derived from the public FlyWire FAFB v783 connectome
distributed with Philip Shiu and Nico Spiller's Drosophila brain model:
https://github.com/philshiu/Drosophila_brain_model
Paper: https://doi.org/10.1038/s41586-024-07763-9
Pinned upstream revision: 91bdd1e7dcf193f3e7ca5a8933497fcef63b7960
Upstream MIT license: ../vendor/brain-model-LICENSE.txt

Public cell classifications and coordinates come from FlyWire Codex FAFB v783:
https://codex.flywire.ai/faq
The exact public input URLs and SHA-256 digests are recorded in sources.json.
Coordinate points are annotation locations, not reconstructed neuron shapes.
Please cite and follow the attribution and usage terms of the original datasets.

This application's FYB2 representation retains all 138,639 nodes and 15,091,983
connections in the prepared graph, with 1,411 output nodes. Root identifiers are
omitted. Integer synapse packing reconstructs the stored float32 weights exactly.
Cloudflare chunks change only the download representation; the decoded model's
SHA-256 remains the one in manifest.json.

The browser simulator uses a different random stream and floating-point addition
order from the source implementation. Card-state encoding, candidate search,
and a trained external readout are application code. This is an artificial
game interface to a neural simulation, not evidence that a biological fly can
understand or play cards.
