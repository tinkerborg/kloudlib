/**
 * @module "@kloudlib/grafana"
 * @packageDocumentation
 * @example
 * ```typescript
 * import { Grafana } from '@kloudlib/grafana';
 *
 * new Grafana('grafana', {
 *   // ...
 * });
 * ```
 */

import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as random from '@pulumi/random';
import * as abstractions from '@kloudlib/abstractions';
import { replaceApiVersion } from '@kloudlib/utils';

export interface GrafanaInputs {
  provider?: k8s.Provider;
  namespace?: pulumi.Input<string>;
  /**
   * the helm chart version
   */
  version?: string;
  /**
   * import dasboards into grafana.
   * defaults to undefined.
   */
  dashboards?: Array<GrafanaDashboard>;
  /**
   * grafana datasources
   */
  datasources?: GrafanaDataSource[];
  /**
   * ingress resource configuration
   * defaults to undefined (no ingress resource will be created)
   */
  ingress?: abstractions.Ingress;
  /**
   * persistent storage configuration
   * defaults to undefined (no persistent storage will be used)
   */
  persistence?: abstractions.Persistence;
}

export type GrafanaDashboard = { name: string } & (
  | { json: string }
  | { file: string }
  | { gnetId: number; revision?: number; datasource?: string }
  | { url: string; b64content?: boolean }
);

export interface GrafanaOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  adminUsername: pulumi.Output<string>;
  adminPassword: pulumi.Output<string>;
  ingress: pulumi.Output<abstractions.Ingress | undefined>;
  persistence: pulumi.Output<abstractions.Persistence | undefined>;
}

export interface GrafanaDataSource {
  name: string;
  type: 'prometheus' | 'loki';
  url: string;
}

/**
 * @noInheritDoc
 */
export class Grafana extends pulumi.ComponentResource implements GrafanaOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly adminUsername: pulumi.Output<string>;
  readonly adminPassword: pulumi.Output<string>;
  readonly ingress: pulumi.Output<abstractions.Ingress | undefined>;
  readonly persistence: pulumi.Output<abstractions.Persistence | undefined>;

  constructor(name: string, props?: GrafanaInputs, opts?: pulumi.CustomResourceOptions) {
    super('kloudlib:Grafana', name, props, opts);

    this.ingress = pulumi.output(props?.ingress);
    this.persistence = pulumi.output(props?.persistence);

    const password = new random.RandomString(
      'grafana-admin-password',
      {
        length: 32,
        special: false,
      },
      {
        parent: this,
      }
    );

    this.adminUsername = pulumi.output('admin');
    this.adminPassword = password.result;

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'grafana',
      version: props?.version ?? '4.2.2',
      repo: 'https://kubernetes-charts.storage.googleapis.com',
    });

    const grafana = new k8s.helm.v2.Chart(
      `${name}-grafana`,
      {
        namespace: props?.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        fetchOpts: {
          repo: this.meta.repo,
        },
        transformations: [replaceApiVersion('Ingress', 'extensions/v1beta1', 'networking.k8s.io/v1beta1')],
        values: {
          adminUser: this.adminUsername,
          adminPassword: this.adminPassword,
          ingress: !props?.ingress
            ? { enabled: false }
            : {
                enabled: props?.ingress.enabled ?? true,
                annotations: {
                  'kubernetes.io/ingress.class': props?.ingress.class ?? 'nginx',
                  'kubernetes.io/tls-acme': props?.ingress.tls === false ? 'false' : 'true', // "tls" defaults to true, so we'll activate tls for undefined or null values
                  ...props?.ingress.annotations,
                },
                hosts: props?.ingress.hosts,
                tls: [
                  {
                    hosts: props?.ingress.hosts,
                    secretName: `tls-grafana-${name}`,
                  },
                ],
              },
          deploymentStrategy: {
            type: 'Recreate',
          },
          persistence: !props?.persistence
            ? { enabled: false }
            : {
                enabled: props?.persistence.enabled,
                size: pulumi.interpolate`${props?.persistence.sizeGB}Gi`,
                storageClass: props?.persistence.storageClass,
              },
          testFramework: {
            enabled: false,
          },
          'grafana.ini': {
            server: pulumi.output(props?.ingress?.hosts).apply((hosts) =>
              !hosts
                ? undefined
                : {
                    domain: hosts[0],
                    root_url: `https://${hosts[0]}`,
                  }
            ),
            'auth.anonymous': {
              enabled: 'true',
              org_name: 'Main Org.',
              org_role: 'Editor',
            },
            'auth.basic': {
              enabled: 'false',
            },
          },
          datasources: {
            'datasources.yaml': {
              apiVersion: 1,
              datasources: !props?.datasources
                ? []
                : props?.datasources.map((datasource) => ({
                    name: datasource.name,
                    type: datasource.type,
                    url: datasource.url,
                    access: 'proxy',
                    basicAuth: false,
                    editable: false,
                  })),
            },
          },
          dashboards: !props?.dashboards
            ? undefined
            : {
                default: props?.dashboards.reduce((prev, curr) => {
                  const { name, ...rest } = curr;
                  return { ...prev, [name]: rest };
                }, {}),
              },
          dashboardProviders: !props?.dashboards
            ? undefined
            : {
                'dashboardproviders.yaml': {
                  apiVersion: 1,
                  providers: [
                    {
                      name: 'default',
                      orgId: 1,
                      folder: '',
                      type: 'file',
                      disableDeletion: false,
                      editable: true,
                      options: {
                        path: '/var/lib/grafana/dashboards/default',
                      },
                    },
                  ],
                },
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
