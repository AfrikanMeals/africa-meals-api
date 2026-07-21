import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import { RecommendationFacade } from '@modules/graph/recommendation-facade.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { TrackRecommendationDto } from './dto/track-recommendation.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly _svc: RecommendationsService,
    private readonly _facade: RecommendationFacade,
  ) {}

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  async feed(
    @Req() req: Request,
    @Query('take') take?: string,
    @Query('countryCode') countryCode?: string,
  ): Promise<{
    products: Record<string, unknown>[];
    stores: Record<string, unknown>[];
    drinks: Record<string, unknown>[];
    frequentlyBoughtTogether: Record<string, unknown>[];
  }> {
    return this._svc.getFeed(
      req.user as UserModel | undefined,
      take,
      undefined,
      countryCode,
    );
  }

  /**
   * Phase 2 — FBT + similar Neo4j + hydratation Mongo (`products`).
   * Fail-open : source empty si graphe OFF / down.
   */
  @Get('products/:id/related')
  @UseGuards(OptionalAuthGuard)
  async relatedProducts(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('countryCode') countryCode?: string,
  ): Promise<{
    frequentlyBoughtWith: Array<{ productId: string; score: number }>;
    similar: Array<{ productId: string; score: number }>;
    products: Record<string, unknown>[];
    source: 'neo4j' | 'empty';
  }> {
    const limit = Math.min(24, Math.max(1, parseInt(limitRaw ?? '8', 10) || 8));
    return this._svc.getRelatedProducts(id, {
      limit,
      countryCode,
      user: req.user as UserModel | undefined,
    });
  }

  /**
   * Phase 5 — knowledge graph lecture (tags).
   * Toujours valider stock/prix via Mongo avant checkout.
   */
  @Get('knowledge/search')
  @UseGuards(OptionalAuthGuard)
  async knowledgeSearch(
    @Query('tag') tag: string,
    @Query('region') region?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ productIds: string[]; source: 'neo4j' | 'empty' }> {
    const limit = Math.min(
      48,
      Math.max(1, parseInt(limitRaw ?? '24', 10) || 24),
    );
    const ids = await this._facade.knowledgeProductIdsOrNull({
      tag: tag ?? '',
      region,
      limit,
    });
    return {
      productIds: ids ?? [],
      source: ids?.length ? 'neo4j' : 'empty',
    };
  }

  @Post('track')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  async track(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: TrackRecommendationDto,
  ): Promise<void> {
    await this._svc.track(req.user as UserModel, body);
  }
}
