export const catalogProducts = {
  runtime: {
    id: 'shared.onnxruntime',
    name: 'ONNX Runtime',
    kind: 'Runtime',
    bundleName: '',
  },
  model: {
    id: 'shared.clap',
    name: 'CLAP Model',
    kind: 'Model',
    bundleName: '',
  },
  jsonDemo: {
    id: 'shared.json-view-demo',
    name: 'Shared JSON Demo Data',
    kind: 'Blob',
    bundleName: '',
  },
  maze: {
    id: 'com.eacp.maze',
    name: 'Maze',
    kind: 'App',
    bundleName: 'Maze.app',
    target: 'Maze',
    appPath: ['Apps', 'GPU', 'Maze', 'Maze.app'],
    binaryName: 'Maze',
  },
  teapot: {
    id: 'com.eacp.teapot',
    name: 'Teapot',
    kind: 'App',
    bundleName: 'Teapot.app',
    target: 'Teapot',
    appPath: ['Apps', 'GPU', 'Teapot', 'Teapot.app'],
    binaryName: 'Teapot',
  },
  jsonView1: {
    id: 'com.eacp.jsonview1',
    name: 'JsonView1',
    kind: 'App',
    bundleName: 'JsonView1.app',
    target: 'JsonView1',
    appPath: ['Apps', 'System', 'JsonView', 'JsonView1.app'],
    binaryName: 'JsonView1',
    dependencies: ['shared.json-view-demo'],
  },
  jsonView2: {
    id: 'com.eacp.jsonview2',
    name: 'JsonView2',
    kind: 'App',
    bundleName: 'JsonView2.app',
    target: 'JsonView2',
    appPath: ['Apps', 'System', 'JsonView', 'JsonView2.app'],
    binaryName: 'JsonView2',
    dependencies: ['shared.json-view-demo'],
  },
};

export function makeCatalog({
  version,
  releaseBaseUrl,
  runtimeBlob,
  runtimeSha,
  modelBlob,
  modelSha,
  mazeZip,
  mazeSha,
  teapotZip,
  teapotSha,
}) {
  return {
    catalogVersion: Number.parseInt(version.split('.')[0], 10) || 1,
    products: [
      makeProduct({
        ...catalogProducts.runtime,
        version,
        url: `${releaseBaseUrl}/${runtimeBlob}`,
        sha256: runtimeSha,
      }),
      makeProduct({
        ...catalogProducts.model,
        version,
        url: `${releaseBaseUrl}/${modelBlob}`,
        sha256: modelSha,
      }),
      makeProduct({
        ...catalogProducts.maze,
        version,
        url: `${releaseBaseUrl}/${mazeZip}`,
        sha256: mazeSha,
        dependencies: [catalogProducts.runtime.id, catalogProducts.model.id],
      }),
      makeProduct({
        ...catalogProducts.teapot,
        version,
        url: `${releaseBaseUrl}/${teapotZip}`,
        sha256: teapotSha,
        dependencies: [catalogProducts.runtime.id, catalogProducts.model.id],
      }),
    ],
    signature: '',
  };
}

export function makeProduct({
  id,
  name,
  kind,
  bundleName,
  version,
  url,
  sha256,
  dependencies = [],
}) {
  return {
    id,
    name,
    kind,
    bundleName,
    channel: 'stable',
    latestVersion: version,
    dependencies,
    artifacts: [
      {
        platform: 'MacOS',
        architecture: 'Universal',
        url,
        sha256,
        signature: '',
      },
    ],
  };
}

export function replaceCatalogProduct(catalog, product) {
  const products = catalog.products.filter((entry) => entry.id !== product.id);
  products.push(product);
  return {
    ...catalog,
    products: sortProducts(products),
  };
}

export function sortProducts(products) {
  const order = new Map([
    [catalogProducts.runtime.id, 0],
    [catalogProducts.model.id, 1],
    [catalogProducts.jsonDemo.id, 2],
    [catalogProducts.maze.id, 3],
    [catalogProducts.teapot.id, 4],
    [catalogProducts.jsonView1.id, 5],
    [catalogProducts.jsonView2.id, 6],
  ]);
  return [...products].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? 100;
    const rightOrder = order.get(right.id) ?? 100;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}
