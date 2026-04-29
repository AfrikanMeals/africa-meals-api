import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserModel } from '@schemas/user.schema';

export const GqlOptionalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserModel | undefined => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req.user;
  },
);
