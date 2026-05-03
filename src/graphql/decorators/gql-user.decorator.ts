import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserModel } from '@schemas/user.schema';

export const GqlUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserModel => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req.user;
  },
);
