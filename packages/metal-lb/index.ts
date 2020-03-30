/**
 * @module "@kloudlib/metal-lb"
 * @packageDocumentation
 * @example
 * ```typescript
 * import { MetalLB } from '@kloudlib/metal-lb';
 *
 * new MetalLB('metal-lb', {
 *   // ...
 * });
 * ```
 */

import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@kloudlib/abstractions';

export interface MetalLBInputs {
  provider?: k8s.Provider;
  namespace?: pulumi.Input<string>;
  /**
   * the helm chart version
   */
  version?: string;
  addressPools?: AddressPool[];
}

export interface AddressPool {
  name: string;
  protocol: 'layer2';
  addresses: string[];
}

export interface MetalLBOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
}

/**
 * @noInheritDoc
 */
export class MetalLB extends pulumi.ComponentResource implements MetalLBOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;

  constructor(name: string, props?: MetalLBInputs, opts?: pulumi.CustomResourceOptions) {
    super('kloudlib:MetalLB', name, props, opts);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'metallb',
      version: props?.version ?? '0.12.0',
      repo: 'https://kubernetes-charts.storage.googleapis.com',
    });

    const metallb = new k8s.helm.v2.Chart(
      `${name}-metallb`,
      {
        namespace: props?.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        fetchOpts: {
          repo: this.meta.repo,
        },
        values: {
          configInline: {
            'address-pools': props?.addressPools?.map((pool) => ({
              name: pool.name,
              protocol: pool.protocol,
              addresses: pool.addresses,
              'avoid-buggy-ips': true,
            })),
          },
          prometheus: {
            scrapeAnnotations: true,
          },
        },
      },
      {
        parent: this,
        providers: props?.provider
          ? {
              kubernetes: props?.provider,
            }
          : {},
      }
    );
  }
}
