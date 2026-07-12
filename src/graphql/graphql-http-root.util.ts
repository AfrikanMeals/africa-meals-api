import { isGraphqlPlaygroundEnabled } from '@common/security/api-docs-exposure.util';
import { isFastifyHttpAdapter } from '../http-adapter.util';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { DynamicModule } from '@nestjs/common';

/**
 * Fastify 4 n’est pas compatible avec `apollo-server-fastify` (Fastify 3).
 * Express (Cloud Functions) reste sur Apollo ; le process local/PM2 (Fastify) utilise Mercurius.
 */
export function createGraphqlHttpRootModule(): DynamicModule {
  const playground = isGraphqlPlaygroundEnabled();

  if (isFastifyHttpAdapter()) {
    return GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: true,
      useGlobalPrefix: true,
      path: 'graphql',
      graphiql: playground,
      context: (request, reply) => ({ req: request, res: reply }),
    });
  }

  return GraphQLModule.forRoot<ApolloDriverConfig>({
    driver: ApolloDriver,
    autoSchemaFile: true,
    useGlobalPrefix: true,
    path: 'graphql',
    bodyParserConfig: false,
    cache: 'bounded',
    context: ({ req, res }) => ({ req, res }),
    playground,
    introspection: playground,
  });
}

export function graphqlHttpDriverName(): 'mercurius' | 'apollo' {
  return isFastifyHttpAdapter() ? 'mercurius' : 'apollo';
}
